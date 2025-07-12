import json
import time
from calendar import monthrange
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from business_time import selling_business_day_subquery, shift_business_date_expr
from constants import RENOVATION_CARRY_FORWARD_STATIONS, SHOP_KEY_MAP
from db import get_connection
from export_excel import (
    EXPORT_DIR,
    MONTH_NAMES_CN,
    MONTH_NAMES_RU,
    PatternFill,
    SK28_RSK_MAP,
    SK29_RSK_MAP,
    SK30_RSK_MAP,
    STATION_RK_CORRECTIONS,
    _FILL_TOTAL,
    _apply_style,
    _build_sheet_data,
    _get_station_fuel_keys,
    _infer_resource_code_daily,
    _write_station_block,
    get_column_letter,
    openpyxl,
    os,
)


from endpoints.v1.retail.common.query import get_query_date_range

export_api = Blueprint("export_api", __name__)
REPORT_INDEX_PATH = Path(EXPORT_DIR) / ".monthly_report_index.json"


def _load_report_index():
    if not REPORT_INDEX_PATH.exists():
        return {}
    try:
        data = json.loads(REPORT_INDEX_PATH.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _record_report_workbook(year_month, path, last_nonempty_day=None):
    path = Path(path)
    data = _load_report_index()
    item = {
        "file": path.name,
        "updatedAt": path.stat().st_mtime if path.exists() else None,
    }
    if last_nonempty_day is not None:
        item["lastNonemptyDay"] = int(last_nonempty_day)
    elif data.get(year_month, {}).get("file") == path.name:
        previous_day = data[year_month].get("lastNonemptyDay")
        if previous_day is not None:
            item["lastNonemptyDay"] = previous_day
    data[year_month] = item
    try:
        temp_path = REPORT_INDEX_PATH.with_suffix(REPORT_INDEX_PATH.suffix + ".tmp")
        content = json.dumps(data, ensure_ascii=False, indent=2)
        for attempt in range(5):
            try:
                temp_path.write_text(content, encoding="utf-8")
                temp_path.replace(REPORT_INDEX_PATH)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))
    except OSError:
        pass


def _indexed_report_workbook(year_month):
    item = _load_report_index().get(year_month) or {}
    filename = item.get("file")
    if not filename:
        return None
    path = Path(EXPORT_DIR) / filename
    return path if path.exists() else None


def _latest_report_workbook(year_month):
    try:
        year, month = [int(part) for part in year_month.split("-")]
    except (TypeError, ValueError):
        return None
    month_ru = MONTH_NAMES_RU.get(month, "")
    indexed_path = _indexed_report_workbook(year_month)
    if indexed_path:
        return indexed_path
    export_dir = Path(EXPORT_DIR)
    if not export_dir.exists():
        return None
    for path in sorted(export_dir.glob("*.xlsx"), key=lambda item: item.stat().st_mtime, reverse=True):
        workbook = None
        try:
            workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
            sheet = workbook["总表"] if "总表" in workbook.sheetnames else workbook[workbook.sheetnames[0]]
            title = str(sheet.cell(1, 1).value or "")
            if str(year) in title and month_ru and month_ru in title:
                _record_report_workbook(year_month, path)
                return path
        except Exception:
            continue
        finally:
            if workbook is not None:
                workbook.close()
    return None


def _workbook_last_nonempty_day(path):
    workbook = None
    last_day = 0
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet_name in workbook.sheetnames:
            if not sheet_name.endswith("日") or not sheet_name[:2].isdigit():
                continue
            sheet = workbook[sheet_name]
            for row in sheet.iter_rows(min_row=5, values_only=True):
                if float(row[18] or 0) or float(row[20] or 0):
                    last_day = max(last_day, int(sheet_name[:2]))
                    break
    except Exception:
        return 0
    finally:
        if workbook is not None:
            workbook.close()
    return last_day


def _can_reuse_report_workbook(year_month, path):
    try:
        year, month = [int(part) for part in year_month.split("-")]
    except (TypeError, ValueError):
        return False
    today = datetime.now().date()
    if (year, month) > (today.year, today.month):
        return False
    item = _load_report_index().get(year_month) or {}
    last_day = item.get("lastNonemptyDay") if item.get("file") == path.name else None
    if last_day is None:
        last_day = _workbook_last_nonempty_day(path)
        _record_report_workbook(year_month, path, last_day)
    if (year, month) < (today.year, today.month):
        expected_day = monthrange(year, month)[1]
    else:
        completed_day = today - timedelta(days=1)
        expected_day = completed_day.day if (completed_day.year, completed_day.month) == (year, month) else 0
    return int(last_day or 0) >= expected_day


def register_export_routes(app):
    app.register_blueprint(export_api)


@export_api.route('/api/export/monthly/<year_month>')
def api_export_monthly_excel(year_month):
    force_refresh = str(request.args.get("refresh") or "").lower() in {"1", "true", "yes"}
    cached_workbook = _latest_report_workbook(year_month)
    if not force_refresh and cached_workbook and _can_reuse_report_workbook(year_month, cached_workbook):
        return jsonify({
            "status": "ok",
            "file": cached_workbook.name,
            "path": str(cached_workbook),
            "cached": True,
        })

    """导出月度日销表 Excel（总表 + 日分表）"""
    conn = get_connection()
    try:
        cur = conn.cursor()
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start, ym_end = get_query_date_range(year_month)
        station_keys = sorted(SHOP_KEY_MAP.keys())
        selling_by_business_day = selling_business_day_subquery("selling", ym_start, ym_end, station_keys)

        # 查询月度数据
        sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data = \
            _build_sheet_data(cur, ym_start, ym_end, station_keys)

        wb = openpyxl.Workbook()

        # ===== 总表 =====
        ws = wb.active
        ws.freeze_panes = 'E5'
        ws.title = '总表'
        ws.sheet_properties.tabColor = '0066CC'

        col_widths = {1: 6, 2: 16, 3: 14, 4: 12, 5: 8, 6: 15, 7: 15, 8: 15, 9: 13,
                      10: 12, 11: 13, 12: 12, 13: 13, 14: 14, 15: 13,
                      16: 13, 17: 13, 18: 12, 19: 13, 20: 13, 21: 13, 22: 14,
                      23: 13, 24: 14, 25: 13, 26: 12}
        for c, w in col_widths.items():
            ws.column_dimensions[get_column_letter(c)].width = w
        # 隐藏辅助列(B列)
        ws.column_dimensions['B'].hidden = True

        # 标题行
        month_ru = MONTH_NAMES_RU.get(m, '')
        _apply_style(ws, 1, 1, f'Ежедневный отчет по АЗС - {month_ru} {y}', bold=True, size=12, h_align='center')
        ws.merge_cells('A1:Z1')
        ws.row_dimensions[1].height = 27

        # 俄语表头（26列，新增辅助列）
        headers_ru = [
            'Номер\nАЗС', 'Наименование\nАЗС', '', 'Наименование\nГСМ\nпо\nвидам', 'Плот\nность',
            'Остаток на начало текущего дня\n(Л)', 'Остаток\nна\nначало\n текущего\nдня (T)',
            'Объем поступления ГСМ в данную смену (Л)', 'Объем перемещения\n ГСМ (T)',
            'Объем Ведомости ГСМ (Л)', 'Объем реализации\nналичными\nГСМ (Л)',
            'объем по реализации бонусной картой',
            'сумма по реализации бонусной картой', 'Сумма реализации наличными\nГСМ\n (СОМ)',
            'объем по реализации\n( пост\n терминал)', 'сумма по реализации\n( пост\n терминал)',
            'Объем Договора\n ГСМ (Л)', 'Цена\nДоговора\n(сом/л)', 'Сумма\nДоговора\n(СОМ)',
            'Объем Обще ГСМ (Л)', 'Объем реализации\nГСМ\n(т)', 'Общая Продажу\n(СОМ)',
            'Цена\nреализации\nза ед.\n(сом/л)',
            'Остаток на конец текущего дня\n(Л)', 'Остаток на конец текущего\nдня\n (t)',
            'Потери\nтоплива\n(Л)'
        ]
        for i, h in enumerate(headers_ru):
            if h:
                _apply_style(ws, 3, i + 1, h, bold=True, size=8, wrap=True)
            else:
                # 辅助列表头：空白但有样式（框线+填充），避免白色无框线
                _apply_style(ws, 3, i + 1, None, bold=True, size=8, wrap=True)
        ws.row_dimensions[3].height = 84

        # 中文表头（26列，新增辅助列）
        headers_cn = ['编号', '辅助列', '加油站名称', '油品名', '密度', '起初量', '起初吨', '转运升', '转运吨',
                      '自用油', '现金销售量', '积分兑换量', '积分兑换金额', '现金销售金额',
                      '刷卡量', '刷卡金额', '合同销售量', '合同单价', '合同金额',
                      '销售总量', '销售总吨', '合计金额', '当月均价',
                      '期末量', '期末吨', '油罐损耗']
        for i, h in enumerate(headers_cn):
            _apply_style(ws, 4, i + 1, h, bold=True, size=9, wrap=True)
        ws.row_dimensions[4].height = 22

        # 写入数据
        current_row = 5
        subtotal_rows = []  # 记录每站小计行号
        for sk in station_keys:
            info = SHOP_KEY_MAP.get(sk, {'name': f'SK-{sk}', 'short': '', 'region': ''})
            # 动态获取该站的油品列表（不再固定 5 行，而是根据实际数据）
            fuel_keys = _get_station_fuel_keys(sk, start_bal, end_bal, sales_data, ved_data, supply_data)
            current_row = _write_station_block(
                ws, current_row, sk, info, sales_data, ved_data, supply_data,
                start_bal, end_bal, contract_data=contract_data, loss_data=loss_data,
                is_monthly=True, fuel_keys=fuel_keys
            )
            subtotal_rows.append(current_row - 1)  # _write_station_block 返回下一行号，小计行在上一行

        # 总合计行
        _apply_style(ws, current_row, 1, '当月总合计', bold=True, size=9, fill=_FILL_TOTAL)
        ws.merge_cells(f'A{current_row}:E{current_row}')
        total_skip_cols = {18, 23}  # 合同单价、当月均价总合计留空
        for col in range(2, 27):
            col_letter = get_column_letter(col)
            if col >= 6:
                if col in total_skip_cols:
                    _apply_style(ws, current_row, col, '', bold=True, size=9, fill=_FILL_TOTAL)
                else:
                    # 汇总所有小计行
                    parts = [f'{col_letter}{r}' for r in subtotal_rows]
                    formula = '=' + '+'.join(parts)
                    _apply_style(ws, current_row, col, formula, bold=True, size=9, fill=_FILL_TOTAL)
            else:
                # 列2~5 合并子单元格需要样式
                _apply_style(ws, current_row, col, None, bold=True, size=9, fill=_FILL_TOTAL)

        # 清除总表 ABCDFGYZ 列填充颜色（除小计/合计行外）
        # 列1=A(编号),2=B(辅助),3=C(站名),4=D(油品),6=F(起初L),7=G(起初吨),25=Y(期末吨),26=Z(损耗) 无背景
        no_fill_cols = {1,2,3,4,6,7,25,26}
        for row in ws.iter_rows(min_row=5, max_row=current_row, max_col=26):
            for cell in row:
                if cell.column in no_fill_cols:
                    if not (cell.row in subtotal_rows or cell.row == current_row):
                        cell.fill = PatternFill(fill_type=None)

        # ===== 预加载日分表数据（避免每天单独查询） =====
        days_in_month = (datetime(y, m + 1, 1) - timedelta(days=1)).day if m < 12 else 31
        actual_days = []
        for dn in range(1, days_in_month + 1):
            try:
                d = datetime(y, m, dn)
            except ValueError:
                continue
            if d > datetime.now():
                break
            actual_days.append(d)

        # 一次性查出当月所有 selling（排除自用油/测试），按天+价格分桶分组
        # SK=28(STN-55)有6个油罐全部 RK=0，用 ResourceShopKey 精确映射
        # 其他站用 BasePrice 价格区间推断
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
                business_day as day_date
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
                    WHEN ResourceKey >= 100 THEN ResourceKey
                    WHEN BasePrice <= 0    THEN ResourceKey
                    WHEN BasePrice <= 45   THEN 108
                    WHEN BasePrice <= 65   THEN 102
                    WHEN BasePrice <= 78   THEN 103
                    WHEN BasePrice <= 83   THEN 104
                    ELSE 106
                END,
                business_day
        """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
        daily_sales_cache = {}
        for r in cur.fetchall():
            sk = int(r[0])
            rk = int(r[1])
            if rk < 100:
                continue
            avg_price = float(r[9] or 0)
            day_str = str(r[11])
            total_vol = float(r[6] or 0)
            bonus_amt = float(r[8] or 0)
            bonus_vol = float(r[10] or 0)
            row_data = {
                'cash_vol': round(float(r[2] or 0), 3), 'cash_amt': round(float(r[3] or 0), 2),
                'card_vol': round(float(r[4] or 0), 3), 'card_amt': round(float(r[5] or 0), 2),
                'total_vol': round(total_vol, 3), 'total_amt': round(float(r[7] or 0), 2),
                'bonus_amt': round(bonus_amt, 2), 'bonus_vol': round(bonus_vol, 3),
                'avg_price': round(avg_price, 2),
            }
            if day_str not in daily_sales_cache:
                daily_sales_cache[day_str] = {}
            if sk not in daily_sales_cache[day_str]:
                daily_sales_cache[day_str][sk] = {}
            if rk not in daily_sales_cache[day_str][sk]:
                daily_sales_cache[day_str][sk][rk] = row_data
            else:
                ex = daily_sales_cache[day_str][sk][rk]
                ex['cash_vol']  = round(ex['cash_vol']  + row_data['cash_vol'],  3)
                ex['cash_amt']  = round(ex['cash_amt']  + row_data['cash_amt'],  2)
                ex['card_vol']  = round(ex['card_vol']  + row_data['card_vol'],  3)
                ex['card_amt']  = round(ex['card_amt']  + row_data['card_amt'],  2)
                ex['total_vol'] = round(ex['total_vol'] + row_data['total_vol'], 3)
                ex['total_amt'] = round(ex['total_amt'] + row_data['total_amt'], 2)
                ex['bonus_amt'] = round(ex['bonus_amt'] + row_data['bonus_amt'], 2)
                ex['bonus_vol'] = round(ex['bonus_vol'] + row_data['bonus_vol'], 3)
                if ex['total_vol'] > 0:
                    ex['avg_price'] = round(ex['total_amt'] / ex['total_vol'], 2)

        # 一次性查出当月所有自用油（价格分桶分组）
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

                    WHEN ResourceKey >= 100 THEN ResourceKey
                    WHEN BasePrice <= 0    THEN ResourceKey
                    WHEN BasePrice <= 45   THEN 108
                    WHEN BasePrice <= 65   THEN 102
                    WHEN BasePrice <= 78   THEN 103
                    WHEN BasePrice <= 83   THEN 104
                    ELSE 106
                END as inferred_rk,
                SUM(Volume) as ved_vol,
                business_day as day_date
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
                    WHEN ResourceKey >= 100 THEN ResourceKey
                    WHEN BasePrice <= 0    THEN ResourceKey
                    WHEN BasePrice <= 45   THEN 108
                    WHEN BasePrice <= 65   THEN 102
                    WHEN BasePrice <= 78   THEN 103
                    WHEN BasePrice <= 83   THEN 104
                    ELSE 106
                END,
                business_day
        """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
        daily_ved_cache = {}
        for r in cur.fetchall():
            sk = int(r[0])
            rk = int(r[1])
            if rk < 100:
                continue
            vol = round(float(r[2] or 0), 3)
            ds = str(r[3])
            d_sk = daily_ved_cache.setdefault(ds, {}).setdefault(sk, {})
            d_sk[rk] = round(d_sk.get(rk, 0) + vol, 3)

        # 一次性查出当月所有转运（附 Density 用于旧编码推断）
        # 同时预查 selling 价格参照表（用于 supply 旧编码推断）
        cur.execute(f"""
            SELECT ShopKey, ResourceKey, AVG(BasePrice) as avg_price
            FROM {selling_by_business_day}
            WHERE business_day >= %s AND business_day < %s
              AND ResourceKey < 100 AND BasePrice > 0
            GROUP BY ShopKey, ResourceKey
        """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
        supply_price_ref = {(int(r[0]), int(r[1])): float(r[2] or 0) for r in cur.fetchall()}

        cur.execute(f"""
            SELECT ShopKey, ResourceKey, SUM(Volume) as supply_vol,
                AVG(Density) as avg_density,
                DATE(AcceptDateTime) as day_date, ResourceShopKey
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
            GROUP BY ShopKey, ResourceKey, DATE(AcceptDateTime), ResourceShopKey
        """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
        daily_supply_cache = {}
        for r in cur.fetchall():
            sk = int(r[0])
            orig_rk = int(r[1])
            vol = round(float(r[2] or 0), 3)
            avg_density = float(r[3] or 0)
            ds = str(r[4])
            rsk = r[5]

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
            else:
                ref_price = supply_price_ref.get((sk, orig_rk), 0)
                if ref_price > 0:
                    if ref_price <= 45:   rk = 108  # СПБТ
                    elif ref_price <= 65: rk = 102
                    elif ref_price <= 78: rk = 103
                    elif ref_price <= 83:
                        rk = 104
                        # 低价柴油（如 SK=6 柴油 80.8）在价格区间上与 АИ-95 重叠，需用密度区分
                        if avg_density > 0.82:
                            rk = 106
                    else:                 rk = 106
                elif avg_density > 0:
                    rk = 106 if avg_density > 0.82 else 103
                else:
                    continue

            if rk < 100:
                continue
            d_sk = daily_supply_cache.setdefault(ds, {}).setdefault(sk, {})
            d_sk[rk] = round(d_sk.get(rk, 0) + vol, 3)

        # 一次性查出当月所有合同销售（DPT=3，价格分桶分组）
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
                business_day as day_date
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

                    WHEN ResourceKey >= 100 THEN ResourceKey
                    WHEN BasePrice <= 0    THEN ResourceKey
                    WHEN BasePrice <= 45   THEN 108
                    WHEN BasePrice <= 65   THEN 102
                    WHEN BasePrice <= 78   THEN 103
                    WHEN BasePrice <= 83   THEN 104
                    ELSE 106
                END,
                business_day
        """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
        daily_contract_cache = {}
        for r in cur.fetchall():
            sk = int(r[0])
            rk = int(r[1])   # inferred_rk（已在 SQL 分桶）
            if rk < 100:
                continue
            vol = round(float(r[2] or 0), 3)
            amt = round(float(r[3] or 0), 2)
            contract_price_val = round(float(r[4] or 0), 2)
            ds = str(r[5])
            d_sk = daily_contract_cache.setdefault(ds, {}).setdefault(sk, {})
            if rk not in d_sk:
                d_sk[rk] = {'vol': vol, 'amt': amt, 'price': contract_price_val}
            else:
                ex = d_sk[rk]
                new_vol = round(ex['vol'] + vol, 3)
                new_amt = round(ex['amt'] + amt, 2)
                d_sk[rk] = {'vol': new_vol, 'amt': new_amt,
                            'price': round(new_amt / new_vol, 2) if new_vol > 0 else 0}

        # 从 balance 表查出当月所有班次的起初量/期末量/损耗
        # 筛选条件：BeginMass IS NOT NULL（仅油罐记录）
        # RK=0 时通过 EndPrice 或 ResourceShopKey 推断油品类型
        month_end_str = (datetime(y, m, days_in_month) + timedelta(days=1)).strftime('%Y-%m-%d')
        shift_business_day = shift_business_date_expr("s")
        cur.execute(f"""
            SELECT b.ShopKey, b.ResourceKey,
                   b.BeginBalance, b.EndBalance, b.EndBalanceCalculation, b.EndPrice,
                   {shift_business_day} as shift_date, b.ResourceShopKey,
                   s.DatetimeShiftBegin
            FROM balance b
            JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
            WHERE b.ShopKey IN (%s)
              AND b.BeginMass IS NOT NULL
              AND {shift_business_day} >= '%s'
              AND {shift_business_day} < '%s'
            ORDER BY b.ShopKey, b.ResourceKey, s.DatetimeShiftBegin
        """ % (','.join(str(k) for k in station_keys), ym_start, month_end_str))
        daily_bal_cache = {}   # day_str -> (sk,rk) -> end_vol（最后班次期末量）
        daily_start_cache = {} # day_str -> (sk,rk) -> start_vol（第一班次起初量，不覆盖）
        daily_loss_cache = {}  # day_str -> (sk,rk) -> loss_vol（最后班次损耗）
        daily_start_dt = {}    # day_str -> (sk,rk) -> earliest_shift_dt
        daily_end_dt = {}      # day_str -> (sk,rk) -> latest_shift_dt
        # 同一油品可能有多个油罐：
        #   - 起初量：取当天第一班，并把同班次同油品多油罐累加
        #   - 期末量/损耗：取当天最后一班，并把同班次同油品多油罐累加
        for r in cur.fetchall():
            sk, rk = int(r[0]), int(r[1])
            if rk >= 100:
                corrected = STATION_RK_CORRECTIONS.get((sk, rk))
                if corrected:
                    rk = corrected
            else:
                rk = _infer_resource_code_daily(rk, r[5], rsk=r[7], sk=sk)
            if rk < 100:
                continue
            ds = str(r[6])
            beg = round(float(r[2] or 0), 3)
            end = round(float(r[3] or 0), 3)
            end_calc = float(r[4] or 0)
            shift_dt = r[8]
            key = (sk, rk)

            ds_start_dt = daily_start_dt.setdefault(ds, {})
            ds_start = daily_start_cache.setdefault(ds, {})
            if key not in ds_start_dt or shift_dt < ds_start_dt[key]:
                ds_start_dt[key] = shift_dt
                ds_start[key] = beg
            elif shift_dt == ds_start_dt[key]:
                ds_start[key] = round(ds_start.get(key, 0) + beg, 3)

            ds_end_dt = daily_end_dt.setdefault(ds, {})
            ds_end = daily_bal_cache.setdefault(ds, {})
            ds_loss = daily_loss_cache.setdefault(ds, {})
            if key not in ds_end_dt or shift_dt > ds_end_dt[key]:
                ds_end_dt[key] = shift_dt
                ds_end[key] = end
                if sk not in (29, 30):
                    ds_loss[key] = round(end_calc - end, 3)
            elif shift_dt == ds_end_dt[key]:
                ds_end[key] = round(ds_end.get(key, 0) + end, 3)
                ds_loss[key] = round(ds_loss.get(key, 0) + (end_calc - end), 3)

        # 零售价：优先从 fuelbalance 取，缺失时从 balance 表取 EndPrice 作为备用
        # 特别注意：SK=28 的 -35号柴油(110) 在 fuelbalance 中可能无价格记录
        cur.execute("""
            SELECT ShopKey, ResourceCode, CurrentPrice,
                DATE(CreateDatetime) as bal_date
            FROM fuelbalance
            WHERE CreateDatetime >= '%s' AND CreateDatetime < '%s'
              AND ShopKey IN (%s)
              AND CurrentPrice > 0
            ORDER BY ShopKey, CreateDatetime DESC, ResourceCode
        """ % (ym_start, month_end_str, ','.join(str(k) for k in station_keys)))
        daily_price_cache = {}
        for r in cur.fetchall():
            sk = int(r[0])
            rc = int(r[1])
            # SK29 fuelbalance.ResourceCode=0，无法推断油品类型，跳过
            # SK29_PRICE_MAP 已在 _write_station_block 中使用硬编码价格
            if sk == 29 and rc < 100:
                continue
            rk = _infer_resource_code_daily(rc, r[2], sk=sk)
            ds = str(r[3])
            if (sk, rk) not in daily_price_cache.get(ds, {}):
                daily_price_cache.setdefault(ds, {})[(sk, rk)] = round(float(r[2] or 0), 2)

        # 备用：从 balance 表取 EndPrice，补充 fuelbalance 中缺失的价格（如 SK=28 的 110）
        cur.execute(f"""
            SELECT b.ShopKey, b.ResourceKey, b.EndPrice,
                {shift_business_day} as shift_date,
                b.ResourceShopKey
            FROM balance b
            JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
            WHERE b.ShopKey IN (%s)
              AND b.BeginMass IS NOT NULL
              AND {shift_business_day} >= '%s'
              AND {shift_business_day} < '%s'
            ORDER BY b.ShopKey, s.DatetimeShiftBegin DESC, b.ResourceKey
        """ % (','.join(str(k) for k in station_keys), ym_start, month_end_str))
        for r in cur.fetchall():
            sk = int(r[0])
            rsk = r[4] if len(r) > 4 else None
            rk = _infer_resource_code_daily(int(r[1]), r[2], rsk=rsk, sk=sk)
            ds = str(r[3])
            # 仅当 fuelbalance 中无价格时才用 balance.EndPrice 补充
            if (sk, rk) not in daily_price_cache.get(ds, {}) and float(r[2] or 0) > 0:
                daily_price_cache.setdefault(ds, {})[(sk, rk)] = round(float(r[2] or 0), 2)

        # 查月初前最新 balance（第一天起初量 = 上月最后班次的 EndBalance）
        pre_month_bal = {}
        pre_month_bal_dt = {}
        month_start_dt = datetime(y, m, 1)
        carry_forward_max_age = timedelta(days=3)
        cur.execute(f"""
            SELECT b.ShopKey, b.ResourceKey, b.EndBalance, b.EndPrice, b.ResourceShopKey,
                   s.DatetimeShiftBegin
            FROM balance b
            JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
            WHERE b.ShopKey IN (%s)
              AND b.BeginMass IS NOT NULL
              AND {shift_business_day} < '%s'
            ORDER BY b.ShopKey, s.DatetimeShiftBegin DESC, b.ResourceKey
        """ % (','.join(str(k) for k in station_keys), ym_start))
        for r in cur.fetchall():
            sk, rk = int(r[0]), int(r[1])
            if rk >= 100:
                corrected = STATION_RK_CORRECTIONS.get((sk, rk))
                if corrected:
                    rk = corrected
            else:
                rk = _infer_resource_code_daily(rk, r[3], rsk=r[4], sk=sk)
            if rk < 100:
                continue
            key = (sk, rk)
            shift_dt = r[5]
            # 仅允许回退月初前最近几天的期末量，避免把长期停业站的陈旧库存带入新月份。
            # 但 1/2 号装修站需长期沿用最近库存快照，直到恢复运营。
            if sk not in RENOVATION_CARRY_FORWARD_STATIONS and month_start_dt - shift_dt > carry_forward_max_age:
                continue
            # 月初前最新一班的期末量，同班次多油罐需要累加
            if key not in pre_month_bal_dt or shift_dt > pre_month_bal_dt[key]:
                pre_month_bal_dt[key] = shift_dt
                pre_month_bal[key] = round(float(r[2] or 0), 3)
            elif shift_dt == pre_month_bal_dt[key]:
                pre_month_bal[key] = round(pre_month_bal[key] + float(r[2] or 0), 3)

        # ===== 日分表 =====
        prev_day_bal = pre_month_bal  # 前一天的期末量，用于次日起初量
        for day in actual_days:
            sheet_name = f'{day.day:02d}日'
            ws_d = wb.create_sheet(title=sheet_name)
            ws_d.sheet_properties.tabColor = '339966'
            ws_d.freeze_panes = 'E5'

            for c, w in col_widths.items():
                ws_d.column_dimensions[get_column_letter(c)].width = w
            # 隐藏辅助列(B列)
            ws_d.column_dimensions['B'].hidden = True

            _apply_style(ws_d, 1, 1, f'Ежедневный отчет по АЗС - {day.day} {month_ru} {y}',
                        bold=True, size=12, h_align='center')
            ws_d.merge_cells('A1:X1')
            ws_d.row_dimensions[1].height = 27

            # 日分表俄语表头（24列，新增辅助列）
            headers_ru_daily = [
                'Номер\nАЗС', 'Наименование\nАЗС', '', 'Наименование\nГСМ\nпо\nвидам', 'Плот\nность',
                'Остаток на начало текущего дня\n(Л)', 'Остаток\nна\nначало\n текущего\nдня (T)',
                'Объем поступления ГСМ в данную смену (Л)', 'Объем перемещения\n ГСМ (T)',
                'Объем Ведомости ГСМ (Л)', 'Объем реализации\nналичными\nГСМ (Л)',
                'Цена\nреализации\nза ед.\n(сом/л)', 'объем по реализации бонусной картой',
                'сумма по реализации бонусной картой', 'Сумма реализации наличными\nГСМ\n (СОМ)',
                'объем по реализации\n( пост\n терминал)', 'сумма по реализации\n( пост\n терминал)',
                'Объем Договора\n ГСМ (Л)', 'Объем Обще ГСМ (Л)',
                'Объем реализации\nГСМ\n(т)', 'Общая Продажу\n(СОМ)',
                'Остаток на конец текущего дня\n(Л)', 'Остаток на конец текущего\nдня\n (t)',
                'Потери\nтоплива\n(Л)'
            ]
            for i, h in enumerate(headers_ru_daily):
                if h:
                    _apply_style(ws_d, 3, i + 1, h, bold=True, size=8, wrap=True)
                else:
                    _apply_style(ws_d, 3, i + 1, None, bold=True, size=8, wrap=True)
            ws_d.row_dimensions[3].height = 84

            # 日分表中文表头（24列，新增辅助列）
            headers_cn_daily = ['编号', '辅助列', '加油站名称', '油品名', '密度', '起初量', '起初吨', '转运升', '转运吨',
                                '自用油', '现金销售量', '现金单价', '积分兑换量', '积分兑换金额', '现金销售金额',
                                '刷卡量', '刷卡金额', '合同销售量', '销售量升', '销售量吨', '合计金额',
                                '期末量', '期末吨', '油罐损耗']
            for i, h in enumerate(headers_cn_daily):
                _apply_style(ws_d, 4, i + 1, h, bold=True, size=9, wrap=True)
            ws_d.row_dimensions[4].height = 22

            # 从缓存取数据
            day_str = day.strftime('%Y-%m-%d')
            d_sales = daily_sales_cache.get(day_str, {})
            d_ved = daily_ved_cache.get(day_str, {})
            d_supply = daily_supply_cache.get(day_str, {})
            d_contract = daily_contract_cache.get(day_str, {})
            d_end_bal = daily_bal_cache.get(day_str, {})
            # 起初量：当天有实测数据优先用实测，否则按站点/油品粒度回退到上一天期末量
            # 注意：不能整体做 or 判断（当天有其他站数据时字典非空，会导致无数据的站回退失效）
            _today_start = daily_start_cache.get(day_str, {})
            d_start_bal = {}
            for key in set(list(_today_start.keys()) + list(prev_day_bal.keys())):
                if key in _today_start and _today_start[key] > 0:
                    d_start_bal[key] = _today_start[key]
                elif key in prev_day_bal and prev_day_bal[key] > 0:
                    d_start_bal[key] = prev_day_bal[key]
            d_loss = daily_loss_cache.get(day_str, {})
            # 日分表现金单价 = 当天 fuelbalance 实际零售价（非均价）
            d_prices = daily_price_cache.get(day_str, {})
            # 用浅拷贝替换 avg_price，避免污染缓存
            d_sales_daily = {}
            for sk_key, rk_dict in d_sales.items():
                d_sales_daily[sk_key] = {}
                for rk_key, val_dict in rk_dict.items():
                    new_dict = dict(val_dict)
                    actual_price = d_prices.get((sk_key, rk_key), 0)
                    if actual_price > 0:
                        new_dict['avg_price'] = actual_price
                    d_sales_daily[sk_key][rk_key] = new_dict
            # 对于有 fuelbalance 价格但无销售数据的油品，补充价格信息
            for (sk_key, rk_key), price in d_prices.items():
                if price > 0 and rk_key not in d_sales_daily.get(sk_key, {}):
                    d_sales_daily.setdefault(sk_key, {})[rk_key] = {'avg_price': price}

            current_row_d = 5
            daily_subtotal_rows = []
            for sk in station_keys:
                info = SHOP_KEY_MAP.get(sk, {'name': f'SK-{sk}', 'short': '', 'region': ''})
                # 动态获取该站的油品列表（不再固定 5 行）
                fuel_keys = _get_station_fuel_keys(sk, d_start_bal, d_end_bal, d_sales_daily, d_ved, d_supply)
                current_row_d = _write_station_block(
                    ws_d, current_row_d, sk, info, d_sales_daily, d_ved, d_supply,
                    d_start_bal, d_end_bal, contract_data=d_contract,
                    loss_data=d_loss, is_monthly=False, fuel_keys=fuel_keys
                )
                daily_subtotal_rows.append(current_row_d - 1)

            # 日合计行
            _apply_style(ws_d, current_row_d, 1, 'Итого на текущий день', bold=True, size=9, fill=_FILL_TOTAL)
            ws_d.merge_cells(f'A{current_row_d}:E{current_row_d}')
            daily_total_skip_cols = {12}  # 现金单价总合计留空
            for col in range(6, 25):
                col_letter = get_column_letter(col)
                if col in daily_total_skip_cols:
                    _apply_style(ws_d, current_row_d, col, '', bold=True, size=9, fill=_FILL_TOTAL)
                else:
                    parts = [f'{col_letter}{r}' for r in daily_subtotal_rows]
                    formula = '=' + '+'.join(parts)
                    _apply_style(ws_d, current_row_d, col, formula, bold=True, size=9, fill=_FILL_TOTAL)

            # 更新 prev_day_bal：当天期末量如果没有数据则沿用前一天的
            merged = dict(prev_day_bal)
            merged.update(d_end_bal)
            prev_day_bal = merged

            # 清除日分表列颜色（除小计/合计行外）
            # 无背景色列：1=A(编号),2=B(辅助),3=C(站名),4=D(油品),6=F(起初L),7=G(起初吨),24=X(损耗)
            daily_no_fill_cols = {1, 2, 3, 4, 6, 7, 24}
            for row in ws_d.iter_rows(min_row=5, max_row=current_row_d, max_col=24):
                for cell in row:
                    if cell.column in daily_no_fill_cols:
                        if not (cell.row in daily_subtotal_rows or cell.row == current_row_d):
                            cell.fill = PatternFill(fill_type=None)

        # 保存文件：加油站+中文月份日销表+俄罗斯格式日期
        month_cn = MONTH_NAMES_CN.get(m, f'{m}月')
        yesterday = datetime.now() - timedelta(days=1)
        gen_date = yesterday.strftime('%d.%m')  # 俄罗斯格式日期和月份 DD.MM（前一天）
        filename = f'加油站{month_cn}日销表{gen_date}.xlsx'
        filepath = os.path.join(EXPORT_DIR, filename)
        wb.save(filepath)
        _record_report_workbook(year_month, Path(filepath), _workbook_last_nonempty_day(Path(filepath)))

        return jsonify({'status': 'ok', 'file': filename, 'path': filepath, 'cached': False})
    finally:
            conn.close()


@export_api.route('/api/export/monthly/<year_month>/download')
def api_export_download(year_month):
    cached_workbook = _latest_report_workbook(year_month)
    if cached_workbook and cached_workbook.exists():
        return send_file(cached_workbook, as_attachment=True, download_name=cached_workbook.name)

    """下载已生成的 Excel 文件"""
    y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
    month_cn = MONTH_NAMES_CN.get(m, f'{m}月')
    yesterday = datetime.now() - timedelta(days=1)
    gen_date = yesterday.strftime('%d.%m')  # 俄罗斯格式日期和月份 DD.MM（前一天）
    filename = f'加油站{month_cn}日销表{gen_date}.xlsx'
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found, please generate first'}), 404

    display_name = f'加油站{month_cn}日销表{gen_date}.xlsx'
    return send_file(filepath, as_attachment=True, download_name=f'加油站{month_cn}日销表{gen_date}.xlsx')
