from calendar import monthrange
from copy import copy
from datetime import datetime, timedelta
from pathlib import Path

from business_time import selling_business_day_subquery, shift_business_date_expr
from constants import RENOVATION_CARRY_FORWARD_STATIONS, SHOP_KEY_MAP
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
from endpoints.v1.retail.export.service.workbook import (
    WEEKLY_REPORT_DIR,
    _can_reuse_report_workbook,
    _latest_report_workbook,
    _record_report_workbook,
    _record_weekly_report_workbook,
    _weekly_report_filename,
    _weekly_report_workbook,
    _workbook_last_nonempty_day,
)


def _copy_summary_template(ws, template_path, title):
    template_workbook = None
    try:
        template_workbook = openpyxl.load_workbook(template_path)
        template_sheet = template_workbook["总表"] if "总表" in template_workbook.sheetnames else template_workbook[template_workbook.sheetnames[0]]

        ws.title = "总表"
        ws.freeze_panes = template_sheet.freeze_panes or "E5"
        ws.sheet_properties.tabColor = template_sheet.sheet_properties.tabColor
        for col in range(1, 27):
            letter = get_column_letter(col)
            source_dim = template_sheet.column_dimensions[letter]
            target_dim = ws.column_dimensions[letter]
            target_dim.width = source_dim.width
            target_dim.hidden = source_dim.hidden

        for row_idx in range(1, 5):
            ws.row_dimensions[row_idx].height = template_sheet.row_dimensions[row_idx].height
            for col_idx in range(1, 27):
                source = template_sheet.cell(row=row_idx, column=col_idx)
                target = ws.cell(row=row_idx, column=col_idx, value=source.value)
                if source.has_style:
                    target.font = copy(source.font)
                    target.fill = copy(source.fill)
                    target.border = copy(source.border)
                    target.alignment = copy(source.alignment)
                    target.protection = copy(source.protection)
                    target.number_format = source.number_format

        for merged_range in template_sheet.merged_cells.ranges:
            if merged_range.min_row <= 4 and merged_range.max_row <= 4:
                ws.merge_cells(str(merged_range))

        ws.cell(row=1, column=1, value=title)
    finally:
        if template_workbook is not None:
            template_workbook.close()


def _write_summary_blocks(ws, station_keys, sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data, total_label):
    current_row = 5
    subtotal_rows = []
    for sk in station_keys:
        info = SHOP_KEY_MAP.get(sk, {"name": f"SK-{sk}", "short": "", "region": ""})
        fuel_keys = _get_station_fuel_keys(sk, start_bal, end_bal, sales_data, ved_data, supply_data)
        current_row = _write_station_block(
            ws, current_row, sk, info, sales_data, ved_data, supply_data,
            start_bal, end_bal, contract_data=contract_data, loss_data=loss_data,
            is_monthly=True, fuel_keys=fuel_keys,
        )
        ws.cell(row=current_row - 1, column=1, value="所选日期小计")
        subtotal_rows.append(current_row - 1)

    _apply_style(ws, current_row, 1, total_label, bold=True, size=9, fill=_FILL_TOTAL)
    ws.merge_cells(f"A{current_row}:E{current_row}")
    total_skip_cols = {18, 23}
    for col in range(2, 27):
        col_letter = get_column_letter(col)
        if col >= 6:
            if col in total_skip_cols:
                _apply_style(ws, current_row, col, "", bold=True, size=9, fill=_FILL_TOTAL)
            else:
                parts = [f"{col_letter}{row}" for row in subtotal_rows]
                formula = "=" + "+".join(parts)
                _apply_style(ws, current_row, col, formula, bold=True, size=9, fill=_FILL_TOTAL)
        else:
            _apply_style(ws, current_row, col, None, bold=True, size=9, fill=_FILL_TOTAL)

    no_fill_cols = {1, 2, 3, 4, 6, 7, 25, 26}
    for row in ws.iter_rows(min_row=5, max_row=current_row, max_col=26):
        for cell in row:
            if cell.column in no_fill_cols and not (cell.row in subtotal_rows or cell.row == current_row):
                cell.fill = PatternFill(fill_type=None)

    return current_row


def generate_range_summary_excel(conn, date_from, date_to, force_refresh=False):
    cached_workbook = _weekly_report_workbook(date_from, date_to)
    if not force_refresh and cached_workbook:
        return {
            "status": "ok",
            "file": cached_workbook.name,
            "path": str(cached_workbook),
            "cached": True,
            "dateFrom": date_from,
            "dateTo": date_to,
        }

    start_dt = datetime.strptime(date_from, "%Y-%m-%d")
    end_dt = datetime.strptime(date_to, "%Y-%m-%d")
    if end_dt < start_dt:
        raise ValueError("date_to must be greater than or equal to date_from")

    template_month = start_dt.strftime("%Y-%m")
    template_result = generate_monthly_excel(conn, template_month, force_refresh=False)
    template_path = Path(template_result.get("path") or "") if template_result.get("path") else _latest_report_workbook(template_month)
    if not template_path or not template_path.exists():
        raise FileNotFoundError("summary template workbook not found")

    station_keys = sorted(SHOP_KEY_MAP.keys())
    range_end = (end_dt + timedelta(days=1)).strftime("%Y-%m-%d")
    cur = conn.cursor()
    sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data = \
        _build_sheet_data(cur, date_from, range_end, station_keys)

    wb = openpyxl.Workbook()
    ws = wb.active
    title = f"Финансовый недельный отчет по АЗС / 加油站零售周报表 {date_from} - {date_to}"
    _copy_summary_template(ws, template_path, title)
    _write_summary_blocks(
        ws, station_keys, sales_data, ved_data, supply_data, contract_data,
        start_bal, end_bal, loss_data, "所选日期总合计",
    )

    WEEKLY_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    filename = _weekly_report_filename(date_from, date_to)
    filepath = WEEKLY_REPORT_DIR / filename
    wb.save(filepath)
    _record_weekly_report_workbook(date_from, date_to, filepath, source="manual")

    return {
        "status": "ok",
        "file": filename,
        "path": str(filepath),
        "cached": False,
        "dateFrom": date_from,
        "dateTo": date_to,
    }


def generate_monthly_excel(conn, year_month, force_refresh=False):
    cached_workbook = _latest_report_workbook(year_month)
    if not force_refresh and cached_workbook and _can_reuse_report_workbook(year_month, cached_workbook):
        return {
            "status": "ok",
            "file": cached_workbook.name,
            "path": str(cached_workbook),
            "cached": True,
        }

    cur = conn.cursor()
    y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
    ym_start, ym_end = get_query_date_range(year_month)
    station_keys = sorted(SHOP_KEY_MAP.keys())
    selling_by_business_day = selling_business_day_subquery("selling", ym_start, ym_end, station_keys)

    sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data = \
        _build_sheet_data(cur, ym_start, ym_end, station_keys)

    wb = openpyxl.Workbook()

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
    ws.column_dimensions['B'].hidden = True

    month_ru = MONTH_NAMES_RU.get(m, '')
    _apply_style(ws, 1, 1, f'Ежедневный отчет по АЗС - {month_ru} {y}', bold=True, size=12, h_align='center')
    ws.merge_cells('A1:Z1')
    ws.row_dimensions[1].height = 27

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
            _apply_style(ws, 3, i + 1, None, bold=True, size=8, wrap=True)
    ws.row_dimensions[3].height = 84

    headers_cn = ['编号', '辅助列', '加油站名称', '油品名', '密度', '起初量', '起初吨', '转运升', '转运吨',
                  '自用油', '现金销售量', '积分兑换量', '积分兑换金额', '现金销售金额',
                  '刷卡量', '刷卡金额', '合同销售量', '合同单价', '合同金额',
                  '销售总量', '销售总吨', '合计金额', '当月均价',
                  '期末量', '期末吨', '油罐损耗']
    for i, h in enumerate(headers_cn):
        _apply_style(ws, 4, i + 1, h, bold=True, size=9, wrap=True)
    ws.row_dimensions[4].height = 22

    current_row = 5
    subtotal_rows = []
    for sk in station_keys:
        info = SHOP_KEY_MAP.get(sk, {'name': f'SK-{sk}', 'short': '', 'region': ''})
        fuel_keys = _get_station_fuel_keys(sk, start_bal, end_bal, sales_data, ved_data, supply_data)
        current_row = _write_station_block(
            ws, current_row, sk, info, sales_data, ved_data, supply_data,
            start_bal, end_bal, contract_data=contract_data, loss_data=loss_data,
            is_monthly=True, fuel_keys=fuel_keys
        )
        subtotal_rows.append(current_row - 1)

    _apply_style(ws, current_row, 1, '当月总合计', bold=True, size=9, fill=_FILL_TOTAL)
    ws.merge_cells(f'A{current_row}:E{current_row}')
    total_skip_cols = {18, 23}
    for col in range(2, 27):
        col_letter = get_column_letter(col)
        if col >= 6:
            if col in total_skip_cols:
                _apply_style(ws, current_row, col, '', bold=True, size=9, fill=_FILL_TOTAL)
            else:
                parts = [f'{col_letter}{r}' for r in subtotal_rows]
                formula = '=' + '+'.join(parts)
                _apply_style(ws, current_row, col, formula, bold=True, size=9, fill=_FILL_TOTAL)
        else:
            _apply_style(ws, current_row, col, None, bold=True, size=9, fill=_FILL_TOTAL)

    no_fill_cols = {1,2,3,4,6,7,25,26}
    for row in ws.iter_rows(min_row=5, max_row=current_row, max_col=26):
        for cell in row:
            if cell.column in no_fill_cols:
                if not (cell.row in subtotal_rows or cell.row == current_row):
                    cell.fill = PatternFill(fill_type=None)

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
                if ref_price <= 45:   rk = 108
                elif ref_price <= 65: rk = 102
                elif ref_price <= 78: rk = 103
                elif ref_price <= 83:
                    rk = 104
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
        rk = int(r[1])
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
    daily_bal_cache = {}
    daily_start_cache = {}
    daily_loss_cache = {}
    daily_start_dt = {}
    daily_end_dt = {}
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
        if sk == 29 and rc < 100:
            continue
        rk = _infer_resource_code_daily(rc, r[2], sk=sk)
        ds = str(r[3])
        if (sk, rk) not in daily_price_cache.get(ds, {}):
            daily_price_cache.setdefault(ds, {})[(sk, rk)] = round(float(r[2] or 0), 2)

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
        if (sk, rk) not in daily_price_cache.get(ds, {}) and float(r[2] or 0) > 0:
            daily_price_cache.setdefault(ds, {})[(sk, rk)] = round(float(r[2] or 0), 2)

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
        if sk not in RENOVATION_CARRY_FORWARD_STATIONS and month_start_dt - shift_dt > carry_forward_max_age:
            continue
        if key not in pre_month_bal_dt or shift_dt > pre_month_bal_dt[key]:
            pre_month_bal_dt[key] = shift_dt
            pre_month_bal[key] = round(float(r[2] or 0), 3)
        elif shift_dt == pre_month_bal_dt[key]:
            pre_month_bal[key] = round(pre_month_bal[key] + float(r[2] or 0), 3)

    prev_day_bal = pre_month_bal
    for day in actual_days:
        sheet_name = f'{day.day:02d}日'
        ws_d = wb.create_sheet(title=sheet_name)
        ws_d.sheet_properties.tabColor = '339966'
        ws_d.freeze_panes = 'E5'

        for c, w in col_widths.items():
            ws_d.column_dimensions[get_column_letter(c)].width = w
        ws_d.column_dimensions['B'].hidden = True

        _apply_style(ws_d, 1, 1, f'Ежедневный отчет по АЗС - {day.day} {month_ru} {y}',
                    bold=True, size=12, h_align='center')
        ws_d.merge_cells('A1:X1')
        ws_d.row_dimensions[1].height = 27

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

        headers_cn_daily = ['编号', '辅助列', '加油站名称', '油品名', '密度', '起初量', '起初吨', '转运升', '转运吨',
                            '自用油', '现金销售量', '现金单价', '积分兑换量', '积分兑换金额', '现金销售金额',
                            '刷卡量', '刷卡金额', '合同销售量', '销售量升', '销售量吨', '合计金额',
                            '期末量', '期末吨', '油罐损耗']
        for i, h in enumerate(headers_cn_daily):
            _apply_style(ws_d, 4, i + 1, h, bold=True, size=9, wrap=True)
        ws_d.row_dimensions[4].height = 22

        day_str = day.strftime('%Y-%m-%d')
        d_sales = daily_sales_cache.get(day_str, {})
        d_ved = daily_ved_cache.get(day_str, {})
        d_supply = daily_supply_cache.get(day_str, {})
        d_contract = daily_contract_cache.get(day_str, {})
        d_end_bal = daily_bal_cache.get(day_str, {})
        _today_start = daily_start_cache.get(day_str, {})
        d_start_bal = {}
        for key in set(list(_today_start.keys()) + list(prev_day_bal.keys())):
            if key in _today_start and _today_start[key] > 0:
                d_start_bal[key] = _today_start[key]
            elif key in prev_day_bal and prev_day_bal[key] > 0:
                d_start_bal[key] = prev_day_bal[key]
        d_loss = daily_loss_cache.get(day_str, {})
        d_prices = daily_price_cache.get(day_str, {})
        d_sales_daily = {}
        for sk_key, rk_dict in d_sales.items():
            d_sales_daily[sk_key] = {}
            for rk_key, val_dict in rk_dict.items():
                new_dict = dict(val_dict)
                actual_price = d_prices.get((sk_key, rk_key), 0)
                if actual_price > 0:
                    new_dict['avg_price'] = actual_price
                d_sales_daily[sk_key][rk_key] = new_dict
        for (sk_key, rk_key), price in d_prices.items():
            if price > 0 and rk_key not in d_sales_daily.get(sk_key, {}):
                d_sales_daily.setdefault(sk_key, {})[rk_key] = {'avg_price': price}

        current_row_d = 5
        daily_subtotal_rows = []
        for sk in station_keys:
            info = SHOP_KEY_MAP.get(sk, {'name': f'SK-{sk}', 'short': '', 'region': ''})
            fuel_keys = _get_station_fuel_keys(sk, d_start_bal, d_end_bal, d_sales_daily, d_ved, d_supply)
            current_row_d = _write_station_block(
                ws_d, current_row_d, sk, info, d_sales_daily, d_ved, d_supply,
                d_start_bal, d_end_bal, contract_data=d_contract,
                loss_data=d_loss, is_monthly=False, fuel_keys=fuel_keys
            )
            daily_subtotal_rows.append(current_row_d - 1)

        _apply_style(ws_d, current_row_d, 1, 'Итого на текущий день', bold=True, size=9, fill=_FILL_TOTAL)
        ws_d.merge_cells(f'A{current_row_d}:E{current_row_d}')
        daily_total_skip_cols = {12}
        for col in range(6, 25):
            col_letter = get_column_letter(col)
            if col in daily_total_skip_cols:
                _apply_style(ws_d, current_row_d, col, '', bold=True, size=9, fill=_FILL_TOTAL)
            else:
                parts = [f'{col_letter}{r}' for r in daily_subtotal_rows]
                formula = '=' + '+'.join(parts)
                _apply_style(ws_d, current_row_d, col, formula, bold=True, size=9, fill=_FILL_TOTAL)

        merged = dict(prev_day_bal)
        merged.update(d_end_bal)
        prev_day_bal = merged

        daily_no_fill_cols = {1, 2, 3, 4, 6, 7, 24}
        for row in ws_d.iter_rows(min_row=5, max_row=current_row_d, max_col=24):
            for cell in row:
                if cell.column in daily_no_fill_cols:
                    if not (cell.row in daily_subtotal_rows or cell.row == current_row_d):
                        cell.fill = PatternFill(fill_type=None)

    month_cn = MONTH_NAMES_CN.get(m, f'{m}月')
    yesterday = datetime.now() - timedelta(days=1)
    gen_date = yesterday.strftime('%d.%m')
    filename = f'加油站{month_cn}日销表{gen_date}.xlsx'
    filepath = os.path.join(EXPORT_DIR, filename)
    wb.save(filepath)
    _record_report_workbook(year_month, Path(filepath), _workbook_last_nonempty_day(Path(filepath)))

    return {'status': 'ok', 'file': filename, 'path': filepath, 'cached': False}
