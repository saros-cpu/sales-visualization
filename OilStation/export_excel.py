from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from business_time import selling_business_day_subquery, shift_business_date_expr
from constants import RENOVATION_CARRY_FORWARD_STATIONS

# ===== API: Excel 报表导出（参考四月份日销表模板） =====
import io
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Color
from openpyxl.utils import get_column_letter

RESOURCE_KEYS = [104, 103, 102, 106, 108]  # АИ95, АИ92, АИ80, Д/Т, СПБТ(液化气)
RESOURCE_NAMES = {102: 'АИ 80', 103: 'АИ 92', 104: 'АИ 95', 106: 'Д/Т', 108: 'СПБТ',
                  109: 'Д/Т', 110: 'ДТ -35'}
RESOURCE_DENSITY = {102: 0.76, 103: 0.74, 104: 0.75, 106: 0.85, 108: 0.554,
                    109: 0.85, 110: 0.85}  # -15 柴油 和 -35 柴油密度统一为 0.85
DB_TRUE_DATA_START = '2026-06-01'
AI80_MISSING_DENSITY_FALLBACK = 0.721
# STN-55(SK=28)特殊油罐映射：ResourceShopKey -> ResourceKey
# SK=28 有6个油罐，全部 ResourceKey=0，通过 fuelbalance.ResourceName 区分
SK28_RSK_MAP = {
    7: 102,   # АИ 80
    8: 103,   # АИ 92
    9: 104,   # АИ 95
    10: 109,  # ДТ -15
    11: 110,  # ДТ -35
    12: 108,  # СПБТ (液化气)
}
# STN-55专用油品列表（6种）
SK28_RESOURCE_KEYS = [104, 103, 102, 109, 110, 108]


def _resource_name_for_report(shop_key, resource_key):
    if shop_key == 28 and resource_key == 109:
        return 'Д/Т'
    return RESOURCE_NAMES.get(resource_key, f'Other-{resource_key}')


def _round_half_up(value, digits=0):
    digits = int(digits or 0)
    try:
        quant = Decimal('1').scaleb(-digits)
        return float(Decimal(str(value or 0)).quantize(quant, rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return 0.0


def _excel_round_formula(expression, digits=3):
    return f'=ROUND({expression},{int(digits or 0)})'

# SK=6 STN-11：通过 ResourceShopKey 精确映射（supply.Density 验证）
# RSK=1→АИ-92(103), RSK=2→АИ-95(104), RSK=3→АИ-80(102), RSK=5→Д/Т(106)
# RSK=4 在4月10日时为ДТ或АИ-95（系统重置前，目前价格推断处理）
SK6_RSK_MAP = {
    1: 103,   # АИ-92 (density≈0.74)
    2: 104,   # АИ-95 (density≈0.75)
    3: 102,   # АИ-80 (density≈0.72)
    5: 106,   # Д/Т   (density≈0.85)
}

# SK=4 STN-07：旧编码场景下通过 ResourceShopKey 精确映射
# 该站没有 80 号，RSK=1/2/5/7 分别对应 92/95/柴油/液化气
SK4_RSK_MAP = {
    1: 103,
    2: 104,
    5: 106,
    7: 108,
}

# SK=30 STN-59（关闭站）：油罐编号调整后 RSK 保持不变，价格/密度不可靠
SK30_RSK_MAP = {
    7: 103,   # АИ-92
    8: 102,   # АИ-80
    9: 106,   # Д/Т
}

# SK=29 STN-57：测试数据清理后 EndPrice=0，价格推断失效
SK29_RSK_MAP = {
    7: 103,   # АИ-92
    8: 102,   # АИ-80
    9: 106,   # Д/Т
    10: 108,  # СПБТ（液化气）
}

# 部分加油站的 ResourceKey 编号非标准：RK=104 实际是 АИ-80 而非 АИ-95
# 经 fuelbalance.ResourceName 交叉验证确认
STATION_RK_CORRECTIONS = {
    (7, 104): 102,   # STN-13：RK=104 = АИ-80
    (15, 104): 102,  # STN-29：RK=104 = АИ-80
    # SK=6 STN-11：系统在4月10日到4月14日之间重新编号了 ResourceKey
    # 4月10日及之前：RK=2(60→АИ80), RK=3(74.3→АИ92), RK=4(80.3→АИ95), RK=5(80.3→Д/Т), RK=6(34→СПБТ)
    # 4月14日及之后：RK 编号已改变，依赖 EndPrice 价格推断更可靠
    # 故 SK=6 不做静态映射，使用 SK6_RSK_MAP 通过 ResourceShopKey 精确区分
}

MONTH_NAMES_RU = {1:'Январь',2:'Февраль',3:'Март',4:'Апрель',5:'Май',6:'Июнь',
                  7:'Июль',8:'Август',9:'Сентябрь',10:'Октябрь',11:'Ноябрь',12:'Декабрь'}
MONTH_NAMES_CN = {1:'一月份',2:'二月份',3:'三月份',4:'四月份',5:'五月份',6:'六月份',
                  7:'七月份',8:'八月份',9:'九月份',10:'十月份',11:'十一月份',12:'十二月份'}

EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exports')
os.makedirs(EXPORT_DIR, exist_ok=True)


class MetricMap(dict):
    """Dict that keeps legacy volume values while carrying DB mass/density side data."""


class BalanceMap(dict):
    """Dict that keeps legacy balance liters while carrying DB mass/density side data."""


def _selling_ai80_condition_expr(prefix=''):
    p = f'{prefix}.' if prefix else ''
    return (
        f"({p}ResourceKey = 102 OR "
        f"({p}ShopKey = 28 AND {p}ResourceShopKey = 7) OR "
        f"({p}ShopKey = 6 AND {p}ResourceShopKey = 3) OR "
        f"({p}ShopKey IN (7, 15) AND {p}ResourceKey = 104) OR "
        f"({p}ShopKey = 29 AND {p}ResourceShopKey = 8) OR "
        f"({p}ShopKey = 30 AND {p}ResourceShopKey = 8) OR "
        f"({p}ResourceKey < 100 AND {p}BasePrice > 45 AND {p}BasePrice <= 65))"
    )


def _selling_mass_expr(prefix='', use_ai80_missing_density_fallback=False):
    p = f'{prefix}.' if prefix else ''
    ai80_fallback = ''
    if use_ai80_missing_density_fallback:
        ai80_fallback = (
            f", CASE WHEN {_selling_ai80_condition_expr(prefix)} "
            f"THEN {p}Volume * {AI80_MISSING_DENSITY_FALLBACK} ELSE NULL END"
        )
    return (
        f"COALESCE(NULLIF({p}Mass, 0), NULLIF({p}MassReal, 0), "
        f"NULLIF({p}MassCalculation, 0), {p}Volume * NULLIF({p}Density, 0), "
        f"{p}Volume * NULLIF({p}DensityReal, 0), "
        f"{p}Volume * NULLIF({p}DensityCalculation, 0), "
        f"{p}Volume * NULLIF({p}PumpDensity, 0){ai80_fallback}, 0)"
    )


def _supply_mass_expr(prefix=''):
    p = f'{prefix}.' if prefix else ''
    return (
        f"COALESCE(NULLIF({p}Mass, 0), NULLIF({p}MassTTN, 0), "
        f"NULLIF({p}TankerMass, 0), {p}Volume * NULLIF({p}Density, 0), "
        f"{p}Volume * NULLIF({p}DensityTTN, 0), "
        f"{p}Volume * NULLIF({p}DocDensity, 0), 0)"
    )


def _balance_begin_mass_expr(prefix='b'):
    p = f'{prefix}.' if prefix else ''
    return (
        f"COALESCE(NULLIF({p}BeginMass, 0), NULLIF({p}BeginMassReal, 0), "
        f"NULLIF({p}BeginMassCalculation, 0), {p}BeginBalance * NULLIF({p}BeginDensity, 0), "
        f"{p}BeginBalance * NULLIF({p}BeginDensityReal, 0), "
        f"{p}BeginBalance * NULLIF({p}BeginDensityCalculation, 0), 0)"
    )


def _balance_end_mass_expr(prefix='b'):
    p = f'{prefix}.' if prefix else ''
    return (
        f"COALESCE(NULLIF({p}EndMass, 0), NULLIF({p}EndMassReal, 0), "
        f"NULLIF({p}EndMassCalculation, 0), {p}EndBalance * NULLIF({p}EndDensity, 0), "
        f"{p}EndBalance * NULLIF({p}EndDensityReal, 0), "
        f"{p}EndBalance * NULLIF({p}EndDensityCalculation, 0), 0)"
    )


def _balance_begin_density_expr(prefix='b'):
    p = f'{prefix}.' if prefix else ''
    return f"COALESCE(NULLIF({p}BeginDensity, 0), NULLIF({p}BeginDensityReal, 0), NULLIF({p}BeginDensityCalculation, 0), 0)"


def _balance_end_density_expr(prefix='b'):
    p = f'{prefix}.' if prefix else ''
    return f"COALESCE(NULLIF({p}EndDensity, 0), NULLIF({p}EndDensityReal, 0), NULLIF({p}EndDensityCalculation, 0), 0)"


def _mass_kg_to_tons(value, digits=3):
    return _round_half_up(float(value or 0) / 1000, int(digits or 0))


def _ton_number_format(digits=3):
    digits = int(digits or 0)
    return '#,##0' if digits <= 0 else '#,##0.' + ('0' * digits)


def _allow_fixed_density_fallback(period_start=None):
    if not period_start:
        return True
    try:
        period_day = datetime.strptime(str(period_start)[:10], '%Y-%m-%d').date()
        cutoff_day = datetime.strptime(DB_TRUE_DATA_START, '%Y-%m-%d').date()
        return period_day < cutoff_day
    except (TypeError, ValueError):
        return True


def _missing_density_fallback_density(resource_key, period_start=None, allow_fixed_density_fallback=None):
    try:
        rk = int(resource_key or 0)
    except (TypeError, ValueError):
        rk = 0
    if allow_fixed_density_fallback is None:
        allow_fixed_density_fallback = _allow_fixed_density_fallback(period_start)
    if allow_fixed_density_fallback:
        return float(RESOURCE_DENSITY.get(rk, 0) or 0)
    if rk == 102:
        return AI80_MISSING_DENSITY_FALLBACK
    return 0


def _mass_from_db_mass_or_density(mass_kg, volume_liters, density=0):
    mass = float(mass_kg or 0)
    volume = float(volume_liters or 0)
    db_density = float(density or 0)
    if mass > 0:
        return _round_half_up(mass, 3)
    if volume > 0 and db_density > 0:
        return _round_half_up(volume * db_density, 3)
    return 0


def _density_from_mass_volume(mass_kg, volume_liters, fallback=0):
    volume = float(volume_liters or 0)
    mass = float(mass_kg or 0)
    if volume > 0 and mass > 0:
        return _round_half_up(mass / volume, 3)
    return _round_half_up(float(fallback or 0), 3)


def _metric_mass(metric_map, shop_key, resource_key, default=0):
    return float(getattr(metric_map, 'mass', {}).get((shop_key, resource_key), default) or 0)


def _metric_density(metric_map, shop_key, resource_key, default=0):
    return float(getattr(metric_map, 'density', {}).get((shop_key, resource_key), default) or 0)


def _make_cell_style(bold=False, size=10, h_align='center', v_align='center', wrap=False):
    return {
        'font': Font(name='Times New Roman', bold=bold, size=size),
        'alignment': Alignment(horizontal=h_align, vertical=v_align, wrap_text=wrap),
        'border': Border(
            left=Side(style='thin', color='000000'),
            right=Side(style='thin', color='000000'),
            top=Side(style='thin', color='000000'),
            bottom=Side(style='thin', color='000000'),
        ),
    }

# 预定义填充色
_FILL_DATA = PatternFill('solid', fgColor=Color(theme=8, tint=0.4))  # 浅蓝（数据行）
_FILL_SUBTOTAL = PatternFill('solid', fgColor='FFFFFF00')             # 黄色（小计行）
_FILL_TOTAL = PatternFill('solid', fgColor='FF00B0F0')                # 蓝色（总合计行）


def _apply_style(ws, row, col, value, bold=False, size=10, h_align='center', v_align='center',
                 wrap=False, num_fmt=None, fill=None):
    style = _make_cell_style(bold=bold, size=size, h_align=h_align, v_align=v_align, wrap=wrap)
    cell = ws.cell(row=row, column=col, value=value)
    cell.font = style['font']
    cell.alignment = style['alignment']
    cell.border = style['border']
    if num_fmt:
        cell.number_format = num_fmt
    if fill:
        cell.fill = fill
    return cell


def _build_sheet_data(cur, ym_start, ym_end, station_keys):
    """为每个站点+油品查询当月销售数据，返回结构化 dict"""

    ym_start_dt = datetime.strptime(ym_start, '%Y-%m-%d')
    selling_by_business_day = selling_business_day_subquery("selling", ym_start, ym_end, station_keys)
    allow_fixed_density_fallback = _allow_fixed_density_fallback(ym_start)

    # 价格分桶 SQL 表达式：对旧编码/RK=0 在数据库层面直接按价格分组为标准 ResourceKey
    # SK=28(STN-55)有6个油罐全部 RK=0，用 ResourceShopKey 精确映射
    RK_BUCKET_EXPR = """
        CASE
            WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
            WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
            WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
            WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
            WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
            WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
            WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
            WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
            WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
            WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
            WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
            WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
            WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
            WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

            WHEN ResourceKey >= 100 THEN ResourceKey
            WHEN BasePrice <= 0    THEN ResourceKey
            WHEN BasePrice <= 45   THEN 108
            WHEN BasePrice <= 65   THEN 102
            WHEN BasePrice <= 78   THEN 103
            WHEN BasePrice <= 83   THEN 104
            ELSE 106
        END
    """

    def _merge_sales(d, sk, rk, row_data):
        """将 row_data 累加到 d[sk][rk]（处理同 sk+rk 多条记录合并）"""
        if sk not in d:
            d[sk] = {}
        if rk not in d[sk]:
            d[sk][rk] = row_data
        else:
            existing = d[sk][rk]
            existing['cash_vol']  = _round_half_up(existing['cash_vol']  + row_data['cash_vol'],  3)
            existing['cash_amt']  = _round_half_up(existing['cash_amt']  + row_data['cash_amt'],  2)
            existing['card_vol']  = _round_half_up(existing['card_vol']  + row_data['card_vol'],  3)
            existing['card_amt']  = _round_half_up(existing['card_amt']  + row_data['card_amt'],  2)
            existing['total_vol'] = _round_half_up(existing['total_vol'] + row_data['total_vol'], 3)
            existing['total_amt'] = _round_half_up(existing['total_amt'] + row_data['total_amt'], 2)
            existing['bonus_amt'] = _round_half_up(existing['bonus_amt'] + row_data['bonus_amt'], 2)
            existing['cash_mass'] = _round_half_up(existing.get('cash_mass', 0) + row_data.get('cash_mass', 0), 3)
            existing['card_mass'] = _round_half_up(existing.get('card_mass', 0) + row_data.get('card_mass', 0), 3)
            existing['total_mass'] = _round_half_up(existing.get('total_mass', 0) + row_data.get('total_mass', 0), 3)
            new_total = existing['total_vol']
            if new_total > 0:
                existing['avg_price'] = _round_half_up(existing['total_amt'] / new_total, 2)
                existing['density'] = _density_from_mass_volume(existing.get('total_mass', 0), new_total, existing.get('density', 0))

    # 查询正常零售数据（排除自用油DPT=2、合同DPT=3、测试DPT=4）
    # GROUP BY 使用价格分桶，确保 RK=0/旧编码按油品正确分组
    # SK=28(STN-55)全部 RK=0，用 ResourceShopKey 精确映射6种油品
    # bonus_vol 用 BonusOutCost/BasePrice 逐笔累加（非加权均价反算）
    selling_mass_expr = _selling_mass_expr(
        use_ai80_missing_density_fallback=not allow_fixed_density_fallback
    )
    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(CASE WHEN BasePaymentTypeKey = 1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN Volume ELSE 0 END) as cash_vol,
            SUM(CASE WHEN BasePaymentTypeKey = 1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN ShopCost ELSE 0 END) as cash_amt,
            SUM(CASE WHEN BasePaymentTypeKey = 2 OR DerivedPaymentTypeKey = 5 THEN Volume ELSE 0 END) as card_vol,
            SUM(CASE WHEN BasePaymentTypeKey = 2 OR DerivedPaymentTypeKey = 5 THEN ShopCost ELSE 0 END) as card_amt,
            SUM(Volume) as total_vol,
            SUM(ShopCost) as total_amt,
            SUM(BonusOutCost) as bonus_amt,
            SUM(BasePrice * Volume) / NULLIF(SUM(Volume), 0) as avg_price,
            SUM(CASE WHEN BasePrice > 0 THEN BonusOutCost / BasePrice ELSE 0 END) as bonus_vol,
            SUM(CASE WHEN BasePaymentTypeKey = 1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN {selling_mass_expr} ELSE 0 END) as cash_mass,
            SUM(CASE WHEN BasePaymentTypeKey = 2 OR DerivedPaymentTypeKey = 5 THEN {selling_mass_expr} ELSE 0 END) as card_mass,
            SUM({selling_mass_expr}) as total_mass,
            SUM({selling_mass_expr}) / NULLIF(SUM(Volume), 0) as weighted_density
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 3, 4))
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (ym_start, ym_end))
    sales_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue  # P=0 且原始编码无法推断，跳过
        avg_price = float(r[9] or 0)
        bonus_amt = float(r[8] or 0)
        bonus_vol = float(r[10] or 0)
        total_mass = float(r[13] or 0)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        _merge_sales(sales_data, sk, rk, {
            'cash_vol': _round_half_up(float(r[2] or 0), 3),
            'cash_amt': _round_half_up(float(r[3] or 0), 2),
            'card_vol': _round_half_up(float(r[4] or 0), 3),
            'card_amt': _round_half_up(float(r[5] or 0), 2),
            'total_vol': _round_half_up(float(r[6] or 0), 3),
            'total_amt': _round_half_up(float(r[7] or 0), 2),
            'bonus_amt': _round_half_up(bonus_amt, 2),
            'bonus_vol': _round_half_up(bonus_vol, 3),
            'avg_price': _round_half_up(avg_price, 2),
            'cash_mass': _round_half_up(float(r[11] or 0), 3),
            'card_mass': _round_half_up(float(r[12] or 0), 3),
            'total_mass': _round_half_up(total_mass, 3),
            'density': _density_from_mass_volume(total_mass, float(r[6] or 0), r[14] or fallback_density),
        })

    # 查询自用油（DerivedPayType=2），按价格分桶分组
    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(Volume) as ved_vol,
            SUM({selling_mass_expr}) as ved_mass,
            SUM({selling_mass_expr}) / NULLIF(SUM(Volume), 0) as weighted_density
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND DerivedPaymentTypeKey = 2
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (ym_start, ym_end))
    ved_data = MetricMap()
    ved_data.mass = {}
    ved_data.density = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        if sk not in ved_data:
            ved_data[sk] = {}
        ved_data[sk][rk] = _round_half_up(ved_data[sk].get(rk, 0) + vol, 3)
        key = (sk, rk)
        ved_data.mass[key] = _round_half_up(ved_data.mass.get(key, 0) + float(r[3] or 0), 3)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        ved_data.density[key] = _density_from_mass_volume(ved_data.mass[key], ved_data[sk][rk], r[4] or fallback_density)

    # 查询合同销售（DerivedPayType=3），按价格分桶分组
    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(Volume) as contract_vol,
            SUM(ShopCost) as contract_amt,
            SUM(ShopCost) / NULLIF(SUM(Volume), 0) as contract_price,
            SUM({selling_mass_expr}) as contract_mass,
            SUM({selling_mass_expr}) / NULLIF(SUM(Volume), 0) as weighted_density
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND DerivedPaymentTypeKey = 3
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey = 6  AND ResourceShopKey = 1  THEN 103
                WHEN ShopKey = 6  AND ResourceShopKey = 2  THEN 104
                WHEN ShopKey = 6  AND ResourceShopKey = 3  THEN 102
                WHEN ShopKey = 6  AND ResourceShopKey = 5  THEN 106
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108
                WHEN ShopKey = 30 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 30 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 30 AND ResourceShopKey = 9  THEN 106

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (ym_start, ym_end))
    contract_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        amt = _round_half_up(float(r[3] or 0), 2)
        contract_price_val = _round_half_up(float(r[4] or 0), 2)
        mass = _round_half_up(float(r[5] or 0), 3)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        density = _density_from_mass_volume(mass, vol, r[6] or fallback_density)
        if sk not in contract_data:
            contract_data[sk] = {}
        if rk not in contract_data[sk]:
            contract_data[sk][rk] = {'vol': vol, 'amt': amt, 'price': contract_price_val, 'mass': mass, 'density': density}
        else:
            existing = contract_data[sk][rk]
            new_vol = _round_half_up(existing['vol'] + vol, 3)
            new_amt = _round_half_up(existing['amt'] + amt, 2)
            new_mass = _round_half_up(existing.get('mass', 0) + mass, 3)
            contract_data[sk][rk] = {
                'vol': new_vol, 'amt': new_amt,
                'price': _round_half_up(new_amt / new_vol, 2) if new_vol > 0 else 0,
                'mass': new_mass,
                'density': _density_from_mass_volume(new_mass, new_vol, existing.get('density', density)),
            }

    # 查询转运（supply 表）
    # 用当月 selling 建立 (SK, RK_old) -> 标准RK 映射，再用 balance 的 RSK 映射
    _rk_std_map_monthly = {}
    # 先查 balance 密度
    _rk_density_m = {}
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceKey, MAX(b.BeginDensity) as max_density
        FROM balance b
        WHERE b.ShopKey IN (%s)
          AND b.BeginMass IS NOT NULL
          AND b.BeginBalance > 0
          AND b.BeginPrice > 0
        GROUP BY b.ShopKey, b.ResourceKey
    """ % (','.join(str(k) for k in station_keys)))
    for r in cur.fetchall():
        _rk_density_m[(int(r[0]), int(r[1]))] = float(r[2] or 0)

    cur.execute(f"""
        SELECT ShopKey, ResourceKey, BasePrice
        FROM %s
        WHERE ShopKey IN (%s)
          AND ResourceKey < 100
          AND BasePrice > 0
          AND business_day >= '%s'
          AND business_day < '%s'
    """ % (selling_by_business_day, ','.join(str(k) for k in station_keys), ym_start, ym_end))
    for r in cur.fetchall():
        key = (int(r[0]), int(r[1]))
        if key in _rk_std_map_monthly:
            continue
        price = float(r[2])
        density = _rk_density_m.get(key, 0)
        if density > 0.82:
            std_rk = 106
        elif price <= 45:    std_rk = 108
        elif price <= 65:  std_rk = 102
        elif price <= 78:  std_rk = 103
        elif price <= 83:  std_rk = 104
        else:              std_rk = 106
        _rk_std_map_monthly[key] = std_rk

    _rsk_std_map_monthly = {}
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceShopKey, b.ResourceKey, b.BeginPrice, b.BeginDensity
        FROM balance b
        WHERE b.ShopKey IN (%s)
          AND b.BeginMass IS NOT NULL
          AND b.BeginBalance > 0
          AND b.ResourceShopKey > 0
          AND b.BeginPrice > 0
        ORDER BY b.ShopKey, b.ResourceShopKey, b.BeginPrice DESC
    """ % (','.join(str(k) for k in station_keys)))
    for r in cur.fetchall():
        sk_rsk = (int(r[0]), int(r[1]))
        if sk_rsk in _rsk_std_map_monthly:
            continue
        orig_rk = int(r[2])
        price = float(r[3])
        density = float(r[4] or 0)
        if int(r[0]) not in (29, 30) and (int(r[0]), orig_rk) in _rk_std_map_monthly:
            _rsk_std_map_monthly[sk_rsk] = _rk_std_map_monthly[(int(r[0]), orig_rk)]
        elif orig_rk >= 100:
            rk = orig_rk
            corrected = STATION_RK_CORRECTIONS.get((int(r[0]), rk))
            if corrected:
                rk = corrected
            _rsk_std_map_monthly[sk_rsk] = rk
        else:
            if density > 0.82:
                _rsk_std_map_monthly[sk_rsk] = 106
            elif price <= 45:    _rsk_std_map_monthly[sk_rsk] = 108
            elif price <= 65:  _rsk_std_map_monthly[sk_rsk] = 102
            elif price <= 78:  _rsk_std_map_monthly[sk_rsk] = 103
            elif price <= 83:  _rsk_std_map_monthly[sk_rsk] = 104
            else:              _rsk_std_map_monthly[sk_rsk] = 106

    cur.execute(f"""
        SELECT ShopKey, ResourceKey,
            AVG(BasePrice) as avg_price
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND ResourceKey < 100
          AND BasePrice > 0
        GROUP BY ShopKey, ResourceKey
    """, (ym_start, ym_end))
    selling_price_ref = {}  # (sk, rk) → avg_price，用于供 supply 推断
    for r in cur.fetchall():
        selling_price_ref[(int(r[0]), int(r[1]))] = float(r[2] or 0)

    supply_mass_expr = _supply_mass_expr()
    cur.execute(f"""
        SELECT ShopKey, ResourceKey, SUM(Volume) as supply_vol,
            AVG(Density) as avg_density, ResourceShopKey,
            SUM({supply_mass_expr}) as supply_mass
        FROM supply
        WHERE AcceptDateTime >= %s AND AcceptDateTime < %s
          AND NOT ((AcceptDateTime >= '2026-06-22 00:00:00'
                    AND AcceptDateTime < '2026-06-23 00:00:00'
                    AND ShopKey IN (29, 30)
                    AND Volume BETWEEN 50 AND 500)
                   OR (AcceptDateTime >= '2026-06-17 00:00:00'
                       AND AcceptDateTime < '2026-06-18 00:00:00'
                       AND ShopKey = 29
                       AND Volume BETWEEN 50 AND 500))
        GROUP BY ShopKey, ResourceKey, ResourceShopKey
    """, (ym_start, ym_end))
    supply_data = MetricMap()
    supply_data.mass = {}
    supply_data.density = {}
    for r in cur.fetchall():
        sk = int(r[0])
        orig_rk = int(r[1])
        vol = _round_half_up(float(r[2] or 0), 3)
        avg_density = float(r[3] or 0)
        rsk = r[4]
        mass = _round_half_up(float(r[5] or 0), 3)

        if orig_rk >= 100:
            rk = orig_rk  # 标准编码，直接使用
            # 修正非标准 RK（如 SK=7/15 的 RK=104 实际是 80 号）
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        elif sk == 28 and rsk is not None:
            # SK=28 专用：通过 ResourceShopKey 精确映射
            rk = SK28_RSK_MAP.get(int(rsk), orig_rk)
        elif sk == 30 and rsk is not None:
            rk = SK30_RSK_MAP.get(int(rsk), orig_rk)
        elif sk == 29 and rsk is not None:
            rk = SK29_RSK_MAP.get(int(rsk), orig_rk)
        elif rsk is not None and (sk, int(rsk)) in _rsk_std_map_monthly:
            # 用 balance 表建立的 RSK→标准RK 映射
            rk = _rsk_std_map_monthly[(sk, int(rsk))]
        else:
            # 优先查 selling 价格参照表
            ref_price = selling_price_ref.get((sk, orig_rk), 0)
            if ref_price > 0:
                # 价格区间推断（与 daily_supply_cache 部分保持一致）
                if ref_price <= 45:   rk = 108  # СПБТ
                elif ref_price <= 65: rk = 102  # АИ-80
                elif ref_price <= 78: rk = 103  # АИ-92
                elif ref_price <= 83:
                    rk = 104  # АИ-95
                    # 低价柴油密度>0.82时覆盖
                    if avg_density > 0.82:
                        rk = 106
                else:                 rk = 106  # Д/Т
            elif avg_density > 0:
                # 无价格参照时用密度推断：柴油 >0.82，汽油各型号无法区分时默认 АИ-92
                if avg_density > 0.82:
                    rk = 106  # Д/Т
                else:
                    rk = 103  # 汽油类，默认 АИ-92（保守估计）
            else:
                continue  # 无法推断，跳过
        if rk < 100:
            continue
        if sk not in supply_data:
            supply_data[sk] = {}
        supply_data[sk][rk] = _round_half_up(supply_data[sk].get(rk, 0) + vol, 3)
        key = (sk, rk)
        supply_data.mass[key] = _round_half_up(supply_data.mass.get(key, 0) + mass, 3)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        supply_data.density[key] = _density_from_mass_volume(supply_data.mass[key], supply_data[sk][rk], avg_density or fallback_density)

    # 29/30 号站今天录入了转运数据，需要用排除 today 后的范围补充查询
    today_str = datetime.now().strftime('%Y-%m-%d')
    if ym_end == today_str:
        cur.execute(f"""
            SELECT ShopKey, ResourceKey, SUM(Volume) as supply_vol,
                AVG(Density) as avg_density, ResourceShopKey,
                SUM({supply_mass_expr}) as supply_mass
            FROM supply
            WHERE AcceptDateTime >= %s AND AcceptDateTime < DATE_ADD(%s, INTERVAL 1 DAY)
              AND ShopKey IN (29, 30)
              AND Volume > 500
            GROUP BY ShopKey, ResourceKey, ResourceShopKey
        """, (ym_end, ym_end))
        for r in cur.fetchall():
            sk = int(r[0])
            orig_rk = int(r[1])
            vol = _round_half_up(float(r[2] or 0), 3)
            avg_density = float(r[3] or 0)
            rsk = r[4]
            mass = _round_half_up(float(r[5] or 0), 3)

            if orig_rk >= 100:
                rk = orig_rk
                corrected = STATION_RK_CORRECTIONS.get((sk, rk))
                if corrected:
                    rk = corrected
            elif sk == 28 and rsk is not None:
                rk = SK28_RSK_MAP.get(int(rsk), orig_rk)
            elif sk == 30 and rsk is not None:
                rk = SK30_RSK_MAP.get(int(rsk), orig_rk)
            elif sk == 29 and rsk is not None:
                rk = SK29_RSK_MAP.get(int(rsk), orig_rk)
            elif rsk is not None and (sk, int(rsk)) in _rsk_std_map_monthly:
                rk = _rsk_std_map_monthly[(sk, int(rsk))]
            else:
                continue

            if rk < 100:
                continue
            if sk not in supply_data:
                supply_data[sk] = {}
            supply_data[sk][rk] = _round_half_up(supply_data[sk].get(rk, 0) + vol, 3)
            key = (sk, rk)
            supply_data.mass[key] = _round_half_up(supply_data.mass.get(key, 0) + mass, 3)
            fallback_density = _missing_density_fallback_density(
                rk, allow_fixed_density_fallback=allow_fixed_density_fallback
            )
            supply_data.density[key] = _density_from_mass_volume(supply_data.mass[key], supply_data[sk][rk], avg_density or fallback_density)


    # 查询 fuelbalance 获取起初量和期末量（月初/月末最近记录）
    # 注意：部分站（如 SK=6 STN-11，SK=28 STN-55）的 ResourceCode=0，
    # 需要通过 CurrentPrice 价格范围推断油品类型
    def _infer_resource_code(rc, price, rsk=None, sk=None):
        """推断 ResourceCode：
        - SK=28 且 rsk 有值时，通过 SK28_RSK_MAP 映射（6个油罐精确区分）
        - SK=6 STN-11且 rsk 有值时，通过 SK6_RSK_MAP 精确映射（解决价格相近导致油品混淆）
        - SK=4 STN-07且 rsk 有值时，通过 SK4_RSK_MAP 精确映射
        - 其他站 rc=0 时通过价格区间推断
        - STATION_RK_CORRECTIONS 修正非标准 RK 映射
        """
        if rc >= 100:
            # 修正非标准 ResourceKey（如 SK=7/15 的 RK=104 实际是 80 号）
            if sk is not None:
                corrected = STATION_RK_CORRECTIONS.get((sk, rc))
                if corrected:
                    return corrected
            return rc
        # SK=6 STN-11：优先通过 ResourceShopKey 精确映射
        if sk == 6 and rsk is not None:
            mapped = SK6_RSK_MAP.get(int(rsk))
            if mapped:
                return mapped
        if sk == 4 and rsk is not None:
            mapped = SK4_RSK_MAP.get(int(rsk))
            if mapped:
                return mapped
        # 低编号 RK 先查 STATION_RK_CORRECTIONS 兜底
        if sk is not None:
            corrected = STATION_RK_CORRECTIONS.get((sk, rc))
            if corrected:
                return corrected
        # SK=28 专用：通过 ResourceShopKey 精确映射
        if sk == 28 and rsk is not None:
            return SK28_RSK_MAP.get(int(rsk), rc)
        # SK=30 关闭站：油罐编号调整后价格不可靠，硬映射
        if sk == 30 and rsk is not None:
            return SK30_RSK_MAP.get(int(rsk), rc)
        # SK=29 新站测试清理后 EndPrice=0，价格推断失效
        if sk == 29 and rsk is not None:
            return SK29_RSK_MAP.get(int(rsk), rc)
        # 通用价格推断
        p = float(price or 0)
        if p <= 45:    return 108  # СПБТ（液化气）
        if p <= 65:    return 102  # АИ-80
        if p <= 78:    return 103  # АИ-92
        if p <= 83:    return 104  # АИ-95
        if p > 83:     return 106  # Д/Т
        return rc  # 无法推断，保持原值

    # 起初量/期末量：从 balance 表取油罐记录的实际测量值（BeginBalance/EndBalance）
    # 筛选条件：有任一质量字段（仅油罐记录，排除仓库/批发记录）
    # RK=0 时通过 EndPrice 或 ResourceShopKey 推断油品类型
    # 损耗 = EndBalanceCalculation - EndBalance

    # --- 起初量：月初第一天班次的 BeginBalance ---
    # 使用当月第一天的班次数据作为起初量，若无数据则不返回起初量
    shift_business_day = shift_business_date_expr("s")
    begin_mass_expr = _balance_begin_mass_expr("b")
    end_mass_expr = _balance_end_mass_expr("b")
    begin_density_expr = _balance_begin_density_expr("b")
    end_density_expr = _balance_end_density_expr("b")
    balance_mass_record_condition = (
        "(b.BeginMass IS NOT NULL OR b.BeginMassReal IS NOT NULL OR "
        "b.BeginMassCalculation IS NOT NULL OR b.EndMass IS NOT NULL OR "
        "b.EndMassReal IS NOT NULL OR b.EndMassCalculation IS NOT NULL)"
    )
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceKey, b.BeginBalance, {begin_mass_expr}, {begin_density_expr},
               b.EndPrice, b.ResourceShopKey,
               s.DatetimeShiftBegin
        FROM balance b
        JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
        WHERE b.ShopKey IN (%s)
          AND {balance_mass_record_condition}
          AND {shift_business_day} >= '%s'
          AND {shift_business_day} < DATE_ADD('%s', INTERVAL 1 DAY)
        ORDER BY b.ShopKey, b.ResourceKey, s.DatetimeShiftBegin ASC
    """ % (','.join(str(k) for k in station_keys), ym_start, ym_start))
    start_balance = BalanceMap()
    start_balance.mass = {}
    start_balance.density = {}
    start_balance_dt = {}
    for r in cur.fetchall():
        sk, rk = int(r[0]), int(r[1])
        if rk >= 100:
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        else:
            rk = _infer_resource_code(rk, r[5], rsk=r[6], sk=sk)
        if rk < 100:
            continue
        key = (sk, rk)
        val = _round_half_up(float(r[2] or 0), 3)
        density = float(r[4] or 0)
        mass = _mass_from_db_mass_or_density(r[3], val, density)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        shift_dt = r[7]
        # 月初起初量：取月首第一班；若同一班次有多个油罐，则累加
        if key not in start_balance_dt or shift_dt < start_balance_dt[key]:
            start_balance_dt[key] = shift_dt
            start_balance[key] = val
            start_balance.mass[key] = mass
            start_balance.density[key] = _density_from_mass_volume(mass, val, density or fallback_density)
        elif shift_dt == start_balance_dt[key]:
            start_balance[key] = _round_half_up(start_balance[key] + val, 3)
            start_balance.mass[key] = _round_half_up(start_balance.mass.get(key, 0) + mass, 3)
            start_balance.density[key] = _density_from_mass_volume(start_balance.mass[key], start_balance[key], density or fallback_density)

    # --- 期末量：当月最后一天班次的 EndBalance ---
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceKey, b.EndBalance, {end_mass_expr}, {end_density_expr},
               b.EndPrice, b.ResourceShopKey,
               s.DatetimeShiftBegin
        FROM balance b
        JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
        WHERE b.ShopKey IN (%s)
          AND {balance_mass_record_condition}
          AND {shift_business_day} >= '%s'
          AND {shift_business_day} < '%s'
        ORDER BY b.ShopKey, b.ResourceKey, s.DatetimeShiftBegin DESC
    """ % (','.join(str(k) for k in station_keys), ym_start, ym_end))
    end_balance = BalanceMap()
    end_balance.mass = {}
    end_balance.density = {}
    end_balance_dt = {}
    for r in cur.fetchall():
        sk, rk = int(r[0]), int(r[1])
        if rk >= 100:
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        else:
            rk = _infer_resource_code(rk, r[5], rsk=r[6], sk=sk)
        if rk < 100:
            continue
        key = (sk, rk)
        val = _round_half_up(float(r[2] or 0), 3)
        density = float(r[4] or 0)
        mass = _mass_from_db_mass_or_density(r[3], val, density)
        fallback_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        shift_dt = r[7]
        # 月末期末量：取月末最后一班；若同一班次有多个油罐，则累加
        if key not in end_balance_dt or shift_dt > end_balance_dt[key]:
            end_balance_dt[key] = shift_dt
            end_balance[key] = val
            end_balance.mass[key] = mass
            end_balance.density[key] = _density_from_mass_volume(mass, val, density or fallback_density)
        elif shift_dt == end_balance_dt[key]:
            end_balance[key] = _round_half_up(end_balance[key] + val, 3)
            end_balance.mass[key] = _round_half_up(end_balance.mass.get(key, 0) + mass, 3)
            end_balance.density[key] = _density_from_mass_volume(end_balance.mass[key], end_balance[key], density or fallback_density)

    # 29/30 号站补充查询当天平衡数据（exclude_today 排除的部分）
    if ym_end == datetime.now().strftime('%Y-%m-%d'):
        cur.execute(f"""
            SELECT b.ShopKey, b.ResourceKey, b.EndBalance, {end_mass_expr}, {end_density_expr},
                   b.EndPrice, b.ResourceShopKey,
                   s.DatetimeShiftBegin
            FROM balance b
            JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
            WHERE b.ShopKey IN (29, 30)
              AND {balance_mass_record_condition}
              AND {shift_business_day} >= '{ym_end}'
              AND {shift_business_day} < DATE_ADD('{ym_end}', INTERVAL 1 DAY)
            ORDER BY b.ShopKey, b.ResourceKey, s.DatetimeShiftBegin DESC
        """)
        seen = set()
        for r in cur.fetchall():
            sk, rk = int(r[0]), int(r[1])
            if rk >= 100:
                corrected = STATION_RK_CORRECTIONS.get((sk, rk))
                if corrected:
                    rk = corrected
            else:
                rk = _infer_resource_code(rk, r[5], rsk=r[6], sk=sk)
            if rk < 100:
                continue
            key = (sk, rk)
            if key in seen:
                continue
            seen.add(key)
            val = _round_half_up(float(r[2] or 0), 3)
            density = float(r[4] or 0)
            mass = _mass_from_db_mass_or_density(r[3], val, density)
            fallback_density = _missing_density_fallback_density(
                rk, allow_fixed_density_fallback=allow_fixed_density_fallback
            )
            shift_dt = r[7]
            if key not in end_balance_dt or shift_dt >= end_balance_dt.get(key, shift_dt):
                end_balance_dt[key] = shift_dt
                end_balance[key] = val
                end_balance.mass[key] = mass
                end_balance.density[key] = _density_from_mass_volume(mass, val, density or fallback_density)

    # 对装修停业站（如 SK=1/2），若新月份内没有任何新班次，
    # 则沿用月初前最新一期末量作为当月起初量；且当月期末量=起初量。
    pre_month_latest_bal = BalanceMap()
    pre_month_latest_bal.mass = {}
    pre_month_latest_bal.density = {}
    pre_month_latest_dt = {}
    carry_sks = sorted(station_keys)
    if carry_sks:
        cur.execute(f"""
            SELECT b.ShopKey, b.ResourceKey, b.EndBalance, {end_mass_expr}, {end_density_expr},
                   b.EndPrice, b.ResourceShopKey,
                   s.DatetimeShiftBegin
            FROM balance b
            JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
            WHERE b.ShopKey IN (%s)
              AND {balance_mass_record_condition}
              AND {shift_business_day} < '%s'
            ORDER BY b.ShopKey, s.DatetimeShiftBegin DESC, b.ResourceKey
        """ % (','.join(str(k) for k in carry_sks), ym_start))
        for r in cur.fetchall():
            sk, rk = int(r[0]), int(r[1])
            if rk >= 100:
                corrected = STATION_RK_CORRECTIONS.get((sk, rk))
                if corrected:
                    rk = corrected
            else:
                rk = _infer_resource_code(rk, r[5], rsk=r[6], sk=sk)
            if rk < 100:
                continue
            key = (sk, rk)
            density = float(r[4] or 0)
            fallback_density = _missing_density_fallback_density(
                rk, allow_fixed_density_fallback=allow_fixed_density_fallback
            )
            shift_dt = r[7]
            val = _round_half_up(float(r[2] or 0), 3)
            mass = _mass_from_db_mass_or_density(r[3], val, density)
            if key not in pre_month_latest_dt or shift_dt > pre_month_latest_dt[key]:
                pre_month_latest_dt[key] = shift_dt
                pre_month_latest_bal[key] = val
                pre_month_latest_bal.mass[key] = mass
                pre_month_latest_bal.density[key] = _density_from_mass_volume(mass, pre_month_latest_bal[key], density or fallback_density)
            elif shift_dt == pre_month_latest_dt[key]:
                pre_month_latest_bal[key] = _round_half_up(pre_month_latest_bal[key] + val, 3)
                pre_month_latest_bal.mass[key] = _round_half_up(pre_month_latest_bal.mass.get(key, 0) + mass, 3)
                pre_month_latest_bal.density[key] = _density_from_mass_volume(pre_month_latest_bal.mass[key], pre_month_latest_bal[key], density or fallback_density)

    # --- 油罐损耗：当月所有班次损耗之和 ---
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceKey, b.EndPrice, b.ResourceShopKey,
               SUM(b.EndBalanceCalculation - b.EndBalance) as total_loss
        FROM balance b
        JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
        WHERE b.ShopKey IN (%s)
          AND {balance_mass_record_condition}
          AND {shift_business_day} >= '%s'
          AND {shift_business_day} < '%s'
        GROUP BY b.ShopKey, b.ResourceKey, b.EndPrice, b.ResourceShopKey
    """ % (','.join(str(k) for k in station_keys), ym_start, ym_end))
    loss_data = {}
    for r in cur.fetchall():
        sk, rk = int(r[0]), int(r[1])
        if sk in (29, 30):
            continue
        if rk >= 100:
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        else:
            rk = _infer_resource_code(rk, r[2], rsk=r[3], sk=sk)
        if rk < 100:
            continue
        key = (sk, rk)
        loss_data[key] = _round_half_up(loss_data.get(key, 0) + float(r[4] or 0), 3)

    active_balance_keys = set(start_balance) | set(end_balance) | set(loss_data)
    for data in (sales_data, ved_data, supply_data, contract_data):
        for sk, by_rk in data.items():
            for rk in by_rk:
                active_balance_keys.add((sk, rk))
    for key in pre_month_latest_bal:
        if key[0] in RENOVATION_CARRY_FORWARD_STATIONS:
            active_balance_keys.add(key)

    for key in active_balance_keys:
        if key not in start_balance and key in pre_month_latest_bal:
            start_balance[key] = pre_month_latest_bal[key]
            start_balance.mass[key] = pre_month_latest_bal.mass.get(key, 0)
            fallback_density = _missing_density_fallback_density(
                key[1], allow_fixed_density_fallback=allow_fixed_density_fallback
            )
            start_balance.density[key] = pre_month_latest_bal.density.get(key, fallback_density)
        if key not in end_balance:
            if key in start_balance:
                end_balance[key] = start_balance[key]
                end_balance.mass[key] = start_balance.mass.get(key, 0)
                fallback_density = _missing_density_fallback_density(
                    key[1], allow_fixed_density_fallback=allow_fixed_density_fallback
                )
                end_balance.density[key] = start_balance.density.get(key, fallback_density)
            elif key in pre_month_latest_bal:
                end_balance[key] = pre_month_latest_bal[key]
                end_balance.mass[key] = pre_month_latest_bal.mass.get(key, 0)
                fallback_density = _missing_density_fallback_density(
                    key[1], allow_fixed_density_fallback=allow_fixed_density_fallback
                )
                end_balance.density[key] = pre_month_latest_bal.density.get(key, fallback_density)

    return sales_data, ved_data, supply_data, contract_data, start_balance, end_balance, loss_data


def _build_daily_sheet_data(cur, day, station_keys):
    """查询单日数据（使用价格分桶 GROUP BY，与 _build_sheet_data 逻辑一致）"""
    day_start = day.strftime('%Y-%m-%d')
    day_end = (day + timedelta(days=1)).strftime('%Y-%m-%d')
    return _build_sheet_data(cur, day_start, day_end, station_keys)

    day_start = day.strftime('%Y-%m-%d 00:00:00')
    day_end = (day + timedelta(days=1)).strftime('%Y-%m-%d 00:00:00')
    selling_by_business_day = selling_business_day_subquery("selling", ym_start_str, ym_end_str, station_keys)

    def _merge_sales_d(d, sk, rk, row_data):
        if sk not in d:
            d[sk] = {}
        if rk not in d[sk]:
            d[sk][rk] = row_data
        else:
            existing = d[sk][rk]
            existing['cash_vol']  = _round_half_up(existing['cash_vol']  + row_data['cash_vol'],  3)
            existing['cash_amt']  = _round_half_up(existing['cash_amt']  + row_data['cash_amt'],  2)
            existing['card_vol']  = _round_half_up(existing['card_vol']  + row_data['card_vol'],  3)
            existing['card_amt']  = _round_half_up(existing['card_amt']  + row_data['card_amt'],  2)
            existing['total_vol'] = _round_half_up(existing['total_vol'] + row_data['total_vol'], 3)
            existing['total_amt'] = _round_half_up(existing['total_amt'] + row_data['total_amt'], 2)
            existing['bonus_amt'] = _round_half_up(existing['bonus_amt'] + row_data['bonus_amt'], 2)
            existing['bonus_vol'] = _round_half_up(existing['bonus_vol'] + row_data['bonus_vol'], 3)
            new_total = existing['total_vol']
            if new_total > 0:
                existing['avg_price'] = _round_half_up(existing['total_amt'] / new_total, 2)

    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(CASE WHEN BasePaymentTypeKey = 1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN Volume ELSE 0 END) as cash_vol,
            SUM(CASE WHEN BasePaymentTypeKey = 1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN ShopCost ELSE 0 END) as cash_amt,
            SUM(CASE WHEN BasePaymentTypeKey = 2 OR DerivedPaymentTypeKey = 5 THEN Volume ELSE 0 END) as card_vol,
            SUM(CASE WHEN BasePaymentTypeKey = 2 OR DerivedPaymentTypeKey = 5 THEN ShopCost ELSE 0 END) as card_amt,
            SUM(Volume) as total_vol,
            SUM(ShopCost) as total_amt,
            SUM(BonusOutCost) as bonus_amt,
            SUM(BasePrice * Volume) / NULLIF(SUM(Volume), 0) as avg_price,
            SUM(CASE WHEN BasePrice > 0 THEN BonusOutCost / BasePrice ELSE 0 END) as bonus_vol
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 3, 4))
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (day_start, day_end))
    sales_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        avg_price = float(r[9] or 0)
        total_vol = float(r[6] or 0)
        bonus_amt = float(r[8] or 0)
        bonus_vol = float(r[10] or 0)
        _merge_sales_d(sales_data, sk, rk, {
            'cash_vol': _round_half_up(float(r[2] or 0), 3),
            'cash_amt': _round_half_up(float(r[3] or 0), 2),
            'card_vol': _round_half_up(float(r[4] or 0), 3),
            'card_amt': _round_half_up(float(r[5] or 0), 2),
            'total_vol': _round_half_up(total_vol, 3),
            'total_amt': _round_half_up(float(r[7] or 0), 2),
            'bonus_amt': _round_half_up(bonus_amt, 2),
            'bonus_vol': _round_half_up(bonus_vol, 3),
            'avg_price': _round_half_up(avg_price, 2),
        })

    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(Volume) as ved_vol
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND DerivedPaymentTypeKey = 2
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (day_start, day_end))
    ved_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        if sk not in ved_data:
            ved_data[sk] = {}
        ved_data[sk][rk] = _round_half_up(ved_data[sk].get(rk, 0) + vol, 3)

    # 查询合同销售（DPT=3）
    cur.execute(f"""
        SELECT ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END as inferred_rk,
            SUM(Volume) as contract_vol,
            SUM(ShopCost) as contract_amt,
            SUM(ShopCost) / NULLIF(SUM(Volume), 0) as contract_price
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND DerivedPaymentTypeKey = 3
        GROUP BY ShopKey,
            CASE
                WHEN ShopKey = 28 AND ResourceShopKey = 7  THEN 102
                WHEN ShopKey = 28 AND ResourceShopKey = 8  THEN 103
                WHEN ShopKey = 28 AND ResourceShopKey = 9  THEN 104
                WHEN ShopKey = 28 AND ResourceShopKey = 10 THEN 109
                WHEN ShopKey = 28 AND ResourceShopKey = 11 THEN 110
                WHEN ShopKey = 28 AND ResourceShopKey = 12 THEN 108
                WHEN ShopKey IN (7, 15) AND ResourceKey = 104 THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 7  THEN 103
                WHEN ShopKey = 29 AND ResourceShopKey = 8  THEN 102
                WHEN ShopKey = 29 AND ResourceShopKey = 9  THEN 106
                WHEN ShopKey = 29 AND ResourceShopKey = 10 THEN 108

                WHEN ResourceKey >= 100 THEN ResourceKey
                WHEN BasePrice <= 0    THEN ResourceKey
                WHEN BasePrice <= 45   THEN 108
                WHEN BasePrice <= 65   THEN 102
                WHEN BasePrice <= 78   THEN 103
                WHEN BasePrice <= 83   THEN 104
                ELSE 106
            END
    """, (day_start, day_end))
    contract_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        amt = _round_half_up(float(r[3] or 0), 2)
        contract_price_val = _round_half_up(float(r[4] or 0), 2)
        if sk not in contract_data:
            contract_data[sk] = {}
        if rk not in contract_data[sk]:
            contract_data[sk][rk] = {'vol': vol, 'amt': amt, 'price': contract_price_val}
        else:
            existing = contract_data[sk][rk]
            new_vol = _round_half_up(existing['vol'] + vol, 3)
            new_amt = _round_half_up(existing['amt'] + amt, 2)
            contract_data[sk][rk] = {
                'vol': new_vol, 'amt': new_amt,
                'price': _round_half_up(new_amt / new_vol, 2) if new_vol > 0 else 0,
            }

    # 查询转运（supply 表）：优先用 balance 的 RSK→标准RK 映射，其次 selling 价格，最后密度推断
    # 建立 RSK→标准RK 映射：从 balance 表取 BeginPrice 最高的记录，用价格推断标准油品编码
    _rsk_std_map = {}  # (ShopKey, ResourceShopKey) -> 标准RK (102/103/104/106/108)
    _rk_std_map = {}   # (ShopKey, ResourceKey) -> 标准RK（用于 RK<100 的站点）
    # 用当月所有 selling 数据建立 (SK, RK_old) -> 标准RK 映射
    # 注意：价格在 78~85 之间的可能是低价柴油（如 SK=6 柴油 80.8），需用 balance 密度确认
    # 先查 balance 表建立 (SK, RK_old) -> 密度 映射
    _rk_density = {}  # (ShopKey, ResourceKey) -> BeginDensity
    cur.execute("""
        SELECT b.ShopKey, b.ResourceKey, MAX(b.BeginDensity) as max_density
        FROM balance b
        WHERE b.ShopKey IN (%s)
          AND b.BeginMass IS NOT NULL
          AND b.BeginBalance > 0
          AND b.BeginPrice > 0
        GROUP BY b.ShopKey, b.ResourceKey
    """ % (','.join(str(k) for k in station_keys)))
    for r in cur.fetchall():
        _rk_density[(int(r[0]), int(r[1]))] = float(r[2] or 0)

    cur.execute("""
        SELECT ShopKey, ResourceKey, BasePrice
        FROM %s
        WHERE ShopKey IN (%s)
          AND ResourceKey < 100
          AND BasePrice > 0
          AND business_day >= '%s'
          AND business_day < '%s'
    """ % (selling_by_business_day, ','.join(str(k) for k in station_keys), ym_start_str, ym_end_str))
    for r in cur.fetchall():
        sk, rk = int(r[0]), int(r[1])
        key = (sk, rk)
        if key in _rk_std_map:
            continue
        price = float(r[2])
        density = _rk_density.get(key, 0)
        # 密度 >0.82 优先判断柴油
        if density > 0.82:
            std_rk = 106
        elif price <= 45:    std_rk = 108
        elif price <= 65:  std_rk = 102
        elif price <= 78:  std_rk = 103
        elif price <= 83:  std_rk = 104
        else:              std_rk = 106
        _rk_std_map[key] = std_rk
    # 用 balance 表建立 (SK, RSK) -> 标准RK 映射（不限时间）
    # 优先用 selling 映射，其次用 balance 密度+价格推断（密度>0.82优先判断柴油）
    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceShopKey, b.ResourceKey, b.BeginPrice, b.BeginDensity
        FROM balance b
        WHERE b.ShopKey IN (%s)
          AND b.BeginMass IS NOT NULL
          AND b.BeginBalance > 0
          AND b.ResourceShopKey > 0
          AND b.BeginPrice > 0
        ORDER BY b.ShopKey, b.ResourceShopKey, b.BeginPrice DESC
    """ % (','.join(str(k) for k in station_keys)))
    for r in cur.fetchall():
        sk_rsk = (int(r[0]), int(r[1]))
        if sk_rsk in _rsk_std_map:
            continue
        orig_rk = int(r[2])
        price = float(r[3])
        density = float(r[4] or 0)
        # 优先用 selling 建立的 (SK, RK) 映射
        if (int(r[0]), orig_rk) in _rk_std_map:
            _rsk_std_map[sk_rsk] = _rk_std_map[(int(r[0]), orig_rk)]
        elif orig_rk >= 100:
            _rsk_std_map[sk_rsk] = orig_rk
        else:
            # 密度 >0.82 优先判断为柴油（即使价格 <83）
            if density > 0.82:
                _rsk_std_map[sk_rsk] = 106
            elif price <= 45:    _rsk_std_map[sk_rsk] = 108
            elif price <= 65:  _rsk_std_map[sk_rsk] = 102
            elif price <= 78:  _rsk_std_map[sk_rsk] = 103
            elif price <= 83:  _rsk_std_map[sk_rsk] = 104
            else:              _rsk_std_map[sk_rsk] = 106

    cur.execute(f"""
        SELECT ShopKey, ResourceKey, AVG(BasePrice) as avg_price
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND ResourceKey < 100 AND BasePrice > 0
        GROUP BY ShopKey, ResourceKey
    """, (day_start, day_end))
    daily_supply_price_ref = {(int(r[0]), int(r[1])): float(r[2] or 0) for r in cur.fetchall()}

    cur.execute("""
        SELECT ShopKey, ResourceKey, SUM(Volume) as supply_vol,
            AVG(Density) as avg_density, ResourceShopKey
        FROM supply
        WHERE AcceptDateTime >= %s AND AcceptDateTime < %s
          AND NOT ((AcceptDateTime >= '2026-06-22 00:00:00'
                    AND AcceptDateTime < '2026-06-23 00:00:00'
                    AND ShopKey IN (29, 30)
                    AND Volume BETWEEN 50 AND 500)
                   OR (AcceptDateTime >= '2026-06-17 00:00:00'
                       AND AcceptDateTime < '2026-06-18 00:00:00'
                       AND ShopKey = 29
                       AND Volume BETWEEN 50 AND 500))
        GROUP BY ShopKey, ResourceKey, ResourceShopKey
    """, (day_start, day_end))
    supply_data = {}
    for r in cur.fetchall():
        sk = int(r[0])
        orig_rk = int(r[1])
        vol = _round_half_up(float(r[2] or 0), 3)
        avg_density = float(r[3] or 0)
        rsk = r[4]

        if orig_rk >= 100:
            rk = orig_rk
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        elif sk == 28 and rsk is not None:
            rk = SK28_RSK_MAP.get(int(rsk), orig_rk)
        elif rsk is not None and (sk, int(rsk)) in _rsk_std_map:
            # 用 balance 表建立的 RSK→标准RK 映射
            rk = _rsk_std_map[(sk, int(rsk))]
        else:
            ref_price = daily_supply_price_ref.get((sk, orig_rk), 0)
            if ref_price > 0:
                if ref_price <= 45:   rk = 108  # СПБТ
                elif ref_price <= 65: rk = 102
                elif ref_price <= 78: rk = 103
                elif ref_price <= 83: rk = 104
                else:                 rk = 106
            elif avg_density > 0:
                rk = 106 if avg_density > 0.82 else 103
            else:
                continue

        if rk < 100:
            continue
        if sk not in supply_data:
            supply_data[sk] = {}
        supply_data[sk][rk] = _round_half_up(supply_data[sk].get(rk, 0) + vol, 3)

    return sales_data, ved_data, supply_data, contract_data


def _v(val):
    """无实际发生数据时返回 None（单元格留空），否则返回原值"""
    return val if val else None


def _get_station_fuel_keys(shop_key, start_bal, end_bal, sales_data, ved_data, supply_data):
    """获取某站应该显示的油品列表
    
    策略：
    1. 标准站固定 5 种油品（95、92、80、柴油、液化气）
    2. SK=28（STN-55）固定 6 种油品
    3. 装修站（SK=1,2）即使只有库存也显示 5 油品
    """
    if shop_key == 28:
        # SK=28（STN-55）固定 6 种油品
        return SK28_RESOURCE_KEYS
    
    # 装修站（SK=1,2 STN-03/北）只有库存数据，但也要显示 5 油品
    # 标准站一律返回 5 种油品：95(104)、92(103)、80(102)、柴油 (106)、液化气 (108)
    return RESOURCE_KEYS


def _write_station_block(ws, row, shop_key, info, sales_data, ved_data, supply_data,
                         start_bal, end_bal, contract_data=None, loss_data=None,
                         is_monthly=True, fuel_keys=None, allow_fixed_density_fallback=True,
                         include_contract_ton=False, ton_decimals=3):
    """写入一个站点的 n_fuel 行油品数据 + 小计行，返回下一行号
    列布局（新增辅助列）：
      1=编号 (合并 n_fuel 行), 2=辅助列 (中俄文站名), 3=加油站名称 (合并 n_fuel 行), 4=油品名，5=密度，6~26/27=数值
    fuel_keys: 该站应该显示的油品列表（动态决定，标准站≤5，STN-55=6）
    """
    name_cn = info['name']
    name_ru = info['short']
    cd = contract_data or {}
    ld = loss_data or {}
    ton_num_fmt = _ton_number_format(ton_decimals)
    normal_num_fmt = '#,##0.000'
    
    # 动态获取油品列表（如果调用方未传入）
    if fuel_keys is None:
        fuel_keys = _get_station_fuel_keys(shop_key, start_bal, end_bal, sales_data, ved_data, supply_data)
    
    n_fuel = len(fuel_keys)  # 根据实际油品数量决定行数

    # === 编号列(1)合并 n_fuel 行 ===
    ws.merge_cells(f'A{row}:A{row + n_fuel - 1}')
    _apply_style(ws, row, 1, shop_key, bold=False, size=9, fill=_FILL_DATA)
    for i in range(1, n_fuel):
        _apply_style(ws, row + i, 1, None, size=9, fill=_FILL_DATA)

    # === 辅助列(2)：中俄文站名（隐藏列，仅用于内部参考） ===
    for i in range(n_fuel):
        _apply_style(ws, row + i, 2, f'{name_ru}\n{name_cn}', bold=False, size=9, wrap=True, fill=_FILL_DATA)

    # === 加油站名称列(3)合并 n_fuel 行，显示中俄文名称 ===
    ws.merge_cells(f'C{row}:C{row + n_fuel - 1}')
    _apply_style(ws, row, 3, f'{name_ru}\n{name_cn}', bold=False, size=9, wrap=True, fill=_FILL_DATA)
    for i in range(1, n_fuel):
        _apply_style(ws, row + i, 3, None, size=9, fill=_FILL_DATA)

    # === 数值列起始位置 ===
    COL_DATA_START = 6  # 列6开始是起初量（月总表26列，日分表24列）

    for i, rk in enumerate(fuel_keys):
        fuel_name = _resource_name_for_report(shop_key, rk)
        fixed_density = _missing_density_fallback_density(
            rk, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        sd = sales_data.get(shop_key, {}).get(rk, {})
        vd = ved_data.get(shop_key, {}).get(rk, 0)
        sp = supply_data.get(shop_key, {}).get(rk, 0)
        balance_key = (shop_key, rk)
        has_start_balance = bool(start_bal and balance_key in start_bal)
        has_end_balance = bool(end_bal and balance_key in end_bal)
        sb = start_bal.get(balance_key, 0) if start_bal else 0
        eb = end_bal.get(balance_key, 0) if end_bal else 0
        sb_mass = _metric_mass(start_bal, shop_key, rk)
        eb_mass = _metric_mass(end_bal, shop_key, rk)
        ct = cd.get(shop_key, {}).get(rk, {})

        if not has_start_balance and has_end_balance:
            if sp > 0:
                pass
            else:
                sb = eb
                sb_mass = eb_mass
                has_start_balance = True
        if not has_end_balance and has_start_balance:
            eb = sb
            eb_mass = sb_mass
            has_end_balance = True

        # 装修停业站在无销售且无新班次时，期末量应与当前起初量一致。
        if shop_key in RENOVATION_CARRY_FORWARD_STATIONS and sb > 0 and eb == 0:
            eb = sb
            eb_mass = sb_mass
            has_end_balance = True

        cash_vol = sd.get('cash_vol', 0)
        cash_amt = sd.get('cash_amt', 0)
        card_vol = sd.get('card_vol', 0)
        card_amt = sd.get('card_amt', 0)
        bonus_vol = sd.get('bonus_vol', 0)
        bonus_amt = sd.get('bonus_amt', 0)
        total_vol = sd.get('total_vol', 0)
        total_amt = sd.get('total_amt', 0)
        avg_price = sd.get('avg_price', 0)
        contract_vol = ct.get('vol', 0)
        contract_amt = ct.get('amt', 0)
        contract_price = ct.get('price', 0)

        cash_mass = float(sd.get('cash_mass') or 0)
        card_mass = float(sd.get('card_mass') or 0)
        total_mass = float(sd.get('total_mass') or 0)
        contract_mass = float(ct.get('mass') or 0)
        supply_mass = _metric_mass(supply_data, shop_key, rk)
        sales_density = float(sd.get('density') or 0)
        contract_density = float(ct.get('density') or 0)
        supply_density = _metric_density(supply_data, shop_key, rk)
        start_density = _metric_density(start_bal, shop_key, rk)
        end_density = _metric_density(end_bal, shop_key, rk)
        if not cash_mass and cash_vol and sales_density:
            cash_mass = cash_vol * sales_density
        if not card_mass and card_vol and sales_density:
            card_mass = card_vol * sales_density
        if not total_mass and total_vol and sales_density:
            total_mass = total_vol * sales_density
        if not contract_mass and contract_vol and contract_density:
            contract_mass = contract_vol * contract_density
        if not supply_mass and sp and supply_density:
            supply_mass = sp * supply_density
        if not sb_mass and sb and start_density:
            sb_mass = sb * start_density
        if not eb_mass and eb and end_density:
            eb_mass = eb * end_density
        if not cash_mass and cash_vol:
            cash_mass = cash_vol * fixed_density
        if not card_mass and card_vol:
            card_mass = card_vol * fixed_density
        if not total_mass and total_vol:
            total_mass = total_vol * fixed_density
        if not contract_mass and contract_vol:
            contract_mass = contract_vol * fixed_density
        if not supply_mass and sp:
            supply_mass = sp * fixed_density
        if not sb_mass and sb:
            sb_mass = sb * fixed_density
        if not eb_mass and eb:
            eb_mass = eb * fixed_density

        density = (
            sales_density
            or supply_density
            or start_density
            or end_density
            or contract_density
            or fixed_density
        )

        sb_ton = _mass_kg_to_tons(sb_mass, ton_decimals)
        sp_ton = _mass_kg_to_tons(supply_mass, ton_decimals)
        eb_ton = _mass_kg_to_tons(eb_mass, ton_decimals)
        total_ton = _mass_kg_to_tons(total_mass, ton_decimals)
        contract_ton = _mass_kg_to_tons(contract_mass, ton_decimals)

        # 活动判断：有无销售/转运/库存数据
        has_activity = (has_start_balance or has_end_balance or sp > 0 or total_vol > 0)

        # 有库存数据：装修停业站也可能有起初量/期末量，以数据库实际数据为准
        has_balance = (has_start_balance or has_end_balance)
        
        # 任务 5、6：修正无效油品数据
        # REG-08 1（SK=17）实际没有液化气（RK=108）数据
        # STN-19（SK=10）的 other-105 无效油品
        if (shop_key == 17 and rk == 108) or (shop_key == 10 and rk == 105):
            if sb == 0 and eb == 0 and total_vol == 0 and sp == 0 and vd == 0:
                # 无实际数据，清零所有值（显示为空）
                sb = eb = sp = total_vol = cash_vol = card_vol = vd = 0
                sb_mass = eb_mass = supply_mass = total_mass = cash_mass = card_mass = contract_mass = 0
                sb_ton = eb_ton = sp_ton = total_ton = contract_ton = 0

        r = row + i
        # 列4=油品名，列5=密度
        _apply_style(ws, r, 4, fuel_name, bold=False, size=9, fill=None)
        _apply_style(ws, r, 5, _round_half_up(density, 3), num_fmt='0.000', size=9, fill=_FILL_DATA)

        if is_monthly:
            # 月/周总表：月报26列，周报可插入合同销售吨位后变为27列。
            sales_total_vol = _round_half_up(cash_vol + card_vol + contract_vol, 3)
            sales_total_amt = _round_half_up(cash_amt + card_amt + contract_amt, 2)
            sales_total_ton = _mass_kg_to_tons(cash_mass + card_mass + contract_mass, ton_decimals)
            loss = ld.get((shop_key, rk), 0)
            monthly_col_end = 27 if include_contract_ton else 26
            monthly_ton_cols = {7, 9, 21, 25}
            monthly_values = [
                (6, sb),
                (7, sb_ton),
                (8, sp),
                (9, sp_ton),
                (10, vd),
                (11, cash_vol),
                (12, bonus_vol),
                (13, bonus_amt),
                (14, cash_amt),
                (15, card_vol),
                (16, card_amt),
                (17, contract_vol),
            ]
            if include_contract_ton:
                monthly_ton_cols = {7, 9, 18, 22, 26}
                monthly_values.extend([
                    (18, contract_ton),
                    (19, contract_price),
                    (20, contract_amt),
                    (21, sales_total_vol),
                    (22, sales_total_ton),
                    (23, sales_total_amt),
                    (24, avg_price),
                    (25, eb),
                    (26, eb_ton),
                    (27, loss),
                ])
            else:
                monthly_values.extend([
                    (18, contract_price),
                    (19, contract_amt),
                    (20, sales_total_vol),
                    (21, sales_total_ton),
                    (22, sales_total_amt),
                    (23, avg_price),
                    (24, eb),
                    (25, eb_ton),
                    (26, loss),
                ])

            if has_activity:
                # 有活动数据：显示所有值
                for col, value in monthly_values:
                    num_fmt = ton_num_fmt if col in monthly_ton_cols else normal_num_fmt
                    _apply_style(ws, r, col, _v(value), num_fmt=num_fmt, size=9, fill=_FILL_DATA)
            elif has_balance:
                # 仅库存数据（装修停业等）：起初量/期末量/损耗以数据库实际数据为准，其余留空
                for col in range(6, monthly_col_end + 1):
                    _apply_style(ws, r, col, None, size=9, fill=_FILL_DATA)
                end_vol_col = 25 if include_contract_ton else 24
                end_ton_col = 26 if include_contract_ton else 25
                loss_col = 27 if include_contract_ton else 26
                balance_values = [(6, sb), (7, sb_ton), (end_vol_col, eb), (end_ton_col, eb_ton), (loss_col, loss)]
                for col, value in balance_values:
                    num_fmt = ton_num_fmt if col in monthly_ton_cols else normal_num_fmt
                    _apply_style(ws, r, col, _v(value), num_fmt=num_fmt, size=9, fill=_FILL_DATA)
            else:
                for col in range(6, monthly_col_end + 1):
                    _apply_style(ws, r, col, None, size=9, fill=_FILL_DATA)
        else:
            # 日分表24列：列6~23（起初量...损耗）
            sales_total_vol = _round_half_up(cash_vol + card_vol + contract_vol, 3)
            sales_total_amt = _round_half_up(cash_amt + card_amt + contract_amt, 2)
            sales_total_ton = _mass_kg_to_tons(cash_mass + card_mass + contract_mass, ton_decimals)
            loss = ld.get((shop_key, rk), 0)

            if has_activity:
                _apply_style(ws, r, 6, _v(sb), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 7, _v(sb_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 8, _v(sp), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 9, _v(sp_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 10, _v(vd), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 11, _v(cash_vol), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 12, _v(avg_price), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 13, _v(bonus_vol), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 14, _v(bonus_amt), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 15, _v(cash_amt), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 16, _v(card_vol), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 17, _v(card_amt), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 18, _v(contract_vol), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 19, _v(sales_total_vol), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 20, _v(sales_total_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 21, _v(sales_total_amt), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 22, _v(eb), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 23, _v(eb_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 24, _v(loss), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
            elif has_balance:
                # 仅库存数据（装修停业等）：起初量/期末量/损耗以数据库实际数据为准
                _apply_style(ws, r, 6, _v(sb), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 7, _v(sb_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 8, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 9, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 10, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 11, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 12, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 13, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 14, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 15, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 16, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 17, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 18, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 19, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 20, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 21, None, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 22, _v(eb), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 23, _v(eb_ton), num_fmt=ton_num_fmt, size=9, fill=_FILL_DATA)
                _apply_style(ws, r, 24, _v(loss), num_fmt='#,##0.000', size=9, fill=_FILL_DATA)
            else:
                for col in range(6, 25):
                    _apply_style(ws, r, col, None, size=9, fill=_FILL_DATA)

    # 小计行
    sub_row = row + n_fuel
    sub_label = '当月小计' if is_monthly else 'Итого на текущий день'
    col_end = 27 if is_monthly and include_contract_ton else (26 if is_monthly else 24)
    _apply_style(ws, sub_row, 1, sub_label, bold=True, size=9, fill=_FILL_SUBTOTAL)
    ws.merge_cells(f'A{sub_row}:E{sub_row}')  # 编号+辅助列+加油站名称(5列合并)
    for col in range(2, col_end + 1):
        _apply_style(ws, sub_row, col, None, bold=True, size=9, fill=_FILL_SUBTOTAL)

    # 用 SUM 公式汇总（单价列不参与求和，留空）
    if is_monthly:
        skip_cols = {19, 24} if include_contract_ton else {18, 23}  # 合同单价、当月均价不参与求和
        subtotal_ton_cols = {7, 9, 18, 22, 26} if include_contract_ton else {7, 9, 21, 25}
    else:
        skip_cols = {12}  # 现金单价不参与求和
        subtotal_ton_cols = {7, 9, 20, 23}

    for col in range(6, col_end + 1):
        col_letter = get_column_letter(col)
        if col in skip_cols:
            _apply_style(ws, sub_row, col, '', bold=True, size=9, fill=_FILL_SUBTOTAL)
        else:
            formula_digits = ton_decimals if col in subtotal_ton_cols else 3
            formula = _excel_round_formula(f'SUM({col_letter}{row}:{col_letter}{row + n_fuel - 1})', formula_digits)
            num_fmt = ton_num_fmt if col in subtotal_ton_cols else normal_num_fmt
            _apply_style(ws, sub_row, col, formula, bold=True, size=9, num_fmt=num_fmt, fill=_FILL_SUBTOTAL)

    return sub_row + 1


def _infer_resource_code_daily(rc, price, rsk=None, sk=None):
    """推断 ResourceCode：与 _build_sheet_data 内的逻辑一致
    - SK=28 且 rsk 有值时，通过 SK28_RSK_MAP 映射
    - SK=6 STN-11且 rsk 有值时，通过 SK6_RSK_MAP 精确映射（解决价格相近导致油品混淆问题）
    - SK=4 STN-07且 rsk 有值时，通过 SK4_RSK_MAP 精确映射
    - 其他站通过价格区间推断
    - STATION_RK_CORRECTIONS 修正非标准 RK 映射（如 SK=7/15 的 RK=104）
    - SK=28 特殊：fuelbalance.ResourceCode 全为0，需通过价格判断
    """
    if rc >= 100:
        if sk is not None:
            corrected = STATION_RK_CORRECTIONS.get((sk, rc))
            if corrected:
                return corrected
        return rc
    # SK=6 STN-11：优先通过 ResourceShopKey 映射（密度验证的精确映射）
    if sk == 6 and rsk is not None:
        mapped = SK6_RSK_MAP.get(int(rsk))
        if mapped:
            return mapped
    if sk == 4 and rsk is not None:
        mapped = SK4_RSK_MAP.get(int(rsk))
        if mapped:
            return mapped
    if sk == 30 and rsk is not None:
        mapped = SK30_RSK_MAP.get(int(rsk))
        if mapped:
            return mapped
    if sk == 29 and rsk is not None:
        mapped = SK29_RSK_MAP.get(int(rsk))
        if mapped:
            return mapped
    # 低编号 RK 先查 STATION_RK_CORRECTIONS（兜底）
    if sk is not None:
        corrected = STATION_RK_CORRECTIONS.get((sk, rc))
        if corrected:
            return corrected
    if sk == 28 and rsk is not None:
        return SK28_RSK_MAP.get(int(rsk), rc)
    # SK=28 特殊：fuelbalance.ResourceCode 全为0，需通过价格判断油品类型
    # 用户确认：SK=28 的 -35号柴油(110) 价格是 95
    if sk == 28:
        p = float(price or 0)
        if abs(p - 95.0) < 1.0:
            return 110  # -35号柴油，价格约95
        if p > 83:
            return 106  # Д/Т（柴油）
        if p <= 45:
            return 108  # СПБТ
        return rc
    p = float(price or 0)
    if p <= 45:   return 108  # СПБТ（液化气，价格通常 < 45）
    if p <= 65:   return 102  # АИ-80
    if p <= 78:   return 103  # АИ-92
    if p <= 83:   return 104  # АИ-95
    if p > 83:    return 106  # Д/Т
    return rc
