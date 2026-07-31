from calendar import monthrange
from copy import copy
from datetime import datetime, timedelta
from pathlib import Path

from business_time import selling_business_day_subquery, shift_business_date_expr
from constants import (
    RENOVATION_CARRY_FORWARD_STATIONS,
    REPORT_HIDDEN_STATION_KEYS,
    REPORT_HIDDEN_STATION_NOTE,
    SHOP_KEY_MAP,
)
from export_excel import (
    EXPORT_DIR,
    BalanceMap,
    Font,
    MetricMap,
    MONTH_NAMES_CN,
    MONTH_NAMES_RU,
    PatternFill,
    SK28_RSK_MAP,
    SK29_RSK_MAP,
    SK30_RSK_MAP,
    STATION_RK_CORRECTIONS,
    _FILL_TOTAL,
    _allow_fixed_density_fallback,
    _apply_style,
    _balance_begin_density_expr,
    _balance_begin_mass_expr,
    _balance_end_density_expr,
    _balance_end_mass_expr,
    _build_sheet_data,
    _density_from_mass_volume,
    _excel_round_formula,
    _get_station_fuel_keys,
    _infer_resource_code_daily,
    _mass_from_db_mass_or_density,
    _round_half_up,
    _selling_mass_expr,
    _supply_mass_expr,
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

PRICE_LIST_20260719_EFFECTIVE_DATE = "2026-07-19"
PRICE_LIST_20260719 = {
    (1, 102): 68.00, (1, 103): 81.80, (1, 106): 96.80,
    (2, 102): 68.00, (2, 103): 81.80, (2, 106): 96.80, (2, 108): 43.70,
    (3, 102): 68.00, (3, 103): 81.80, (3, 104): 96.90, (3, 106): 96.90, (3, 108): 43.90,
    (4, 103): 81.80, (4, 104): 96.90, (4, 106): 96.90, (4, 108): 43.90,
    (5, 102): 68.00, (5, 103): 81.90, (5, 104): 108.90, (5, 106): 96.00, (5, 108): 41.90,
    (6, 102): 68.00, (6, 103): 81.90, (6, 104): 97.90, (6, 106): 96.90,
    (7, 102): 68.00, (7, 103): 81.80, (7, 106): 96.90,
    (8, 102): 69.50, (8, 103): 84.70, (8, 106): 98.90, (8, 108): 44.90,
    (9, 102): 69.50, (9, 103): 84.90, (9, 104): 97.90, (9, 106): 99.20,
    (10, 102): 69.50, (10, 103): 84.00, (10, 104): 97.90, (10, 106): 98.30,
    (13, 102): 69.50, (13, 103): 84.90, (13, 104): 97.90, (13, 106): 99.30, (13, 108): 45.60,
    (14, 102): 69.50, (14, 103): 84.00, (14, 106): 99.20, (14, 108): 44.00,
    (15, 102): 68.00, (15, 103): 84.40, (15, 106): 99.30, (15, 108): 44.00,
    (16, 102): 69.50, (16, 103): 84.40, (16, 106): 99.30,
    (17, 102): 69.50, (17, 103): 82.00, (17, 104): 98.00, (17, 106): 97.30,
    (18, 102): 69.50, (18, 103): 82.00, (18, 106): 97.30,
    (19, 102): 69.50, (19, 103): 80.00, (19, 106): 94.50, (19, 108): 43.90,
    (20, 102): 69.50, (20, 103): 82.90, (20, 104): 108.90, (20, 106): 97.30,
    (22, 102): 69.50, (22, 103): 82.90, (22, 106): 97.30, (22, 108): 43.70,
    (23, 102): 69.50, (23, 103): 82.90, (23, 104): 108.90, (23, 106): 97.30,
    (24, 102): 69.50, (24, 103): 81.90, (24, 106): 97.30, (24, 108): 43.70,
    (25, 102): 69.50, (25, 103): 85.30, (25, 106): 99.30,
    (26, 102): 68.00, (26, 103): 81.90, (26, 104): 108.90, (26, 106): 96.80, (26, 108): 41.90,
    (27, 102): 69.50, (27, 103): 82.00, (27, 104): 98.00, (27, 106): 97.30,
    (28, 102): 68.00, (28, 103): 81.80, (28, 104): 96.90, (28, 109): 96.80, (28, 110): 100.00, (28, 108): 43.00,
    (29, 102): 69.50, (29, 103): 82.00, (29, 106): 97.30, (29, 108): 44.70,
    (30, 102): 68.00, (30, 103): 83.30, (30, 106): 96.90,
}


def monthly_report_filename(year, month, generated_day=None):
    month_cn = MONTH_NAMES_CN.get(int(month), f'{int(month)}月')
    generated_day = generated_day or (datetime.now() - timedelta(days=1))
    return f'加油站{month_cn}日销表{generated_day.strftime("%d.%m")}.xlsx'


def single_day_report_filename(year, month, day, generated_day=None):
    month_cn = MONTH_NAMES_CN.get(int(month), f'{int(month)}月')
    generated_day = generated_day or datetime(int(year), int(month), int(day))
    return f'加油站{month_cn}零售日报{generated_day.strftime("%m.%d")}.xlsx'


def _completed_report_days(year, month, today=None):
    today = today or datetime.now().date()
    if hasattr(today, "date"):
        today = today.date()
    year = int(year)
    month = int(month)
    if (year, month) > (today.year, today.month):
        return []
    if (year, month) < (today.year, today.month):
        last_day = monthrange(year, month)[1]
    else:
        completed_day = today - timedelta(days=1)
        if (completed_day.year, completed_day.month) != (year, month):
            return []
        last_day = completed_day.day
    return [datetime(year, month, day) for day in range(1, last_day + 1)]


def _exclusive_month_end_date(year, month):
    last_day = monthrange(int(year), int(month))[1]
    return (datetime(int(year), int(month), last_day) + timedelta(days=1)).strftime('%Y-%m-%d')


def _single_day_report_result(path, year, month, day):
    return {
        "singleDayFile": path.name,
        "singleDayPath": str(path),
        "singleDayDate": f"{int(year):04d}-{int(month):02d}-{int(day):02d}",
    }


def _save_single_day_report_from_monthly(monthly_path, year, month, day):
    if not day:
        return None
    sheet_name = f"{int(day):02d}日"
    monthly_path = Path(monthly_path)
    if not monthly_path.exists():
        return None
    workbook = None
    try:
        workbook = openpyxl.load_workbook(monthly_path)
        if sheet_name not in workbook.sheetnames:
            return None
        for worksheet in list(workbook.worksheets):
            if worksheet.title != sheet_name:
                workbook.remove(worksheet)
        output_dir = Path(EXPORT_DIR) / "monthly" / str(int(year)) / "daily"
        output_dir.mkdir(parents=True, exist_ok=True)
        filepath = output_dir / single_day_report_filename(year, month, day)
        workbook.save(filepath)
        return _single_day_report_result(filepath, year, month, day)
    finally:
        if workbook is not None:
            workbook.close()


def _official_price_list_for_day(day_str):
    if day_str < PRICE_LIST_20260719_EFFECTIVE_DATE:
        return {}
    return PRICE_LIST_20260719


def _new_metric_map():
    data = MetricMap()
    data.mass = {}
    data.density = {}
    return data


def _daily_metric_map(cache, day_key):
    item = cache.get(day_key)
    if item is None:
        item = _new_metric_map()
        cache[day_key] = item
    return item


def _new_balance_map():
    data = BalanceMap()
    data.mass = {}
    data.density = {}
    return data


def _daily_balance_map(cache, day_key):
    item = cache.get(day_key)
    if item is None:
        item = _new_balance_map()
        cache[day_key] = item
    return item


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


def _has_cyrillic_text(value):
    return any('\u0400' <= char <= '\u052f' for char in str(value or ''))


def _apply_report_russian_fonts(ws, max_row=None, max_col=None):
    for row in ws.iter_rows(max_row=max_row or ws.max_row, max_col=max_col or ws.max_column):
        for cell in row:
            if not _has_cyrillic_text(cell.value):
                continue
            font = copy(cell.font)
            font.name = 'Times New Roman'
            cell.font = font


def _prepare_weekly_summary_template(ws, title):
    for merged_range in list(ws.merged_cells.ranges):
        if merged_range.min_row == 1 and merged_range.max_row == 1:
            ws.unmerge_cells(str(merged_range))
    ws.insert_cols(18)
    ws.column_dimensions['R'].width = 13
    _apply_style(ws, 3, 18, 'Объем Договора\nГСМ (T)', bold=True, size=8, wrap=True)
    _apply_style(ws, 4, 18, '合同销售吨', bold=True, size=9, wrap=True)
    ws.merge_cells('A1:AA1')
    ws.cell(row=1, column=1, value=title)
    _apply_report_russian_fonts(ws, max_row=4, max_col=27)


def _number_format_for_ton_digits(digits):
    digits = int(digits or 0)
    return '#,##0' if digits <= 0 else '#,##0.' + ('0' * digits)


def _hide_closed_station_report_rows(ws, shop_key, start_row, end_row):
    if int(shop_key) not in REPORT_HIDDEN_STATION_KEYS:
        return
    for row_idx in range(int(start_row), int(end_row) + 1):
        ws.row_dimensions[row_idx].hidden = True


def _append_closed_station_report_note(ws, after_row, max_col):
    note_row = int(after_row) + 1
    ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=max_col)
    _apply_style(ws, note_row, 1, REPORT_HIDDEN_STATION_NOTE, size=9, h_align='left', wrap=True)
    ws.row_dimensions[note_row].height = 24
    return note_row


def _write_summary_blocks(ws, station_keys, sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data, total_label, allow_fixed_density_fallback=True, include_contract_ton=False, ton_decimals=3):
    current_row = 5
    subtotal_rows = []
    for sk in station_keys:
        info = SHOP_KEY_MAP.get(sk, {"name": f"SK-{sk}", "short": "", "region": ""})
        fuel_keys = _get_station_fuel_keys(sk, start_bal, end_bal, sales_data, ved_data, supply_data)
        station_start_row = current_row
        current_row = _write_station_block(
            ws, current_row, sk, info, sales_data, ved_data, supply_data,
            start_bal, end_bal, contract_data=contract_data, loss_data=loss_data,
            is_monthly=True, fuel_keys=fuel_keys, allow_fixed_density_fallback=allow_fixed_density_fallback,
            include_contract_ton=include_contract_ton, ton_decimals=ton_decimals,
        )
        _hide_closed_station_report_rows(ws, sk, station_start_row, current_row - 1)
        ws.cell(row=current_row - 1, column=1, value="所选日期小计")
        subtotal_rows.append(current_row - 1)

    _apply_style(ws, current_row, 1, total_label, bold=True, size=9, fill=_FILL_TOTAL)
    ws.merge_cells(f"A{current_row}:E{current_row}")
    col_end = 27 if include_contract_ton else 26
    total_skip_cols = {19, 24} if include_contract_ton else {18, 23}
    total_ton_cols = {7, 9, 18, 22, 26} if include_contract_ton else {7, 9, 21, 25}
    ton_num_fmt = _number_format_for_ton_digits(ton_decimals)
    for col in range(2, col_end + 1):
        col_letter = get_column_letter(col)
        if col >= 6:
            if col in total_skip_cols:
                _apply_style(ws, current_row, col, "", bold=True, size=9, fill=_FILL_TOTAL)
            else:
                parts = [f"{col_letter}{row}" for row in subtotal_rows]
                formula_digits = ton_decimals if col in total_ton_cols else 3
                formula = _excel_round_formula("+".join(parts) or "0", formula_digits)
                num_fmt = ton_num_fmt if col in total_ton_cols else '#,##0.000'
                _apply_style(ws, current_row, col, formula, bold=True, size=9, num_fmt=num_fmt, fill=_FILL_TOTAL)
        else:
            _apply_style(ws, current_row, col, None, bold=True, size=9, fill=_FILL_TOTAL)

    no_fill_cols = {1, 2, 3, 4, 6, 7, 26, 27} if include_contract_ton else {1, 2, 3, 4, 6, 7, 25, 26}
    for row in ws.iter_rows(min_row=5, max_row=current_row, max_col=col_end):
        for cell in row:
            if cell.column in no_fill_cols and not (cell.row in subtotal_rows or cell.row == current_row):
                cell.fill = PatternFill(fill_type=None)

    _append_closed_station_report_note(ws, current_row, col_end)
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
    allow_fixed_density_fallback = _allow_fixed_density_fallback(date_from)
    cur = conn.cursor()
    sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data = \
        _build_sheet_data(cur, date_from, range_end, station_keys)

    wb = openpyxl.Workbook()
    wb._fonts[0] = Font(name='Times New Roman', size=11)
    ws = wb.active
    title = f"Финансовый недельный отчет по АЗС / 加油站零售周报表 {date_from} - {date_to}"
    _copy_summary_template(ws, template_path, title)
    _prepare_weekly_summary_template(ws, title)
    _write_summary_blocks(
        ws, station_keys, sales_data, ved_data, supply_data, contract_data,
        start_bal, end_bal, loss_data, "所选日期总合计", allow_fixed_density_fallback=allow_fixed_density_fallback,
        include_contract_ton=True, ton_decimals=4,
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
    y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
    cached_workbook = _latest_report_workbook(year_month)
    if not force_refresh and cached_workbook and _can_reuse_report_workbook(year_month, cached_workbook):
        last_nonempty_day = _workbook_last_nonempty_day(cached_workbook)
        single_day_report = _save_single_day_report_from_monthly(cached_workbook, y, m, last_nonempty_day)
        result = {
            "status": "ok",
            "file": cached_workbook.name,
            "path": str(cached_workbook),
            "cached": True,
        }
        if single_day_report:
            result.update(single_day_report)
            result["singleDayDownloadUrl"] = f"/api/export/monthly/{year_month}/daily/download"
        return result

    cur = conn.cursor()
    ym_start, ym_end = get_query_date_range(year_month)
    allow_fixed_density_fallback = _allow_fixed_density_fallback(ym_start)
    station_keys = sorted(SHOP_KEY_MAP.keys())
    selling_by_business_day = selling_business_day_subquery("selling", ym_start, ym_end, station_keys)

    sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, loss_data = \
        _build_sheet_data(cur, ym_start, ym_end, station_keys)

    wb = openpyxl.Workbook()
    wb._fonts[0] = Font(name='Times New Roman', size=11)

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
        station_start_row = current_row
        current_row = _write_station_block(
            ws, current_row, sk, info, sales_data, ved_data, supply_data,
            start_bal, end_bal, contract_data=contract_data, loss_data=loss_data,
            is_monthly=True, fuel_keys=fuel_keys, allow_fixed_density_fallback=allow_fixed_density_fallback
        )
        _hide_closed_station_report_rows(ws, sk, station_start_row, current_row - 1)
        subtotal_rows.append(current_row - 1)

    _apply_style(ws, current_row, 1, '当月总合计', bold=True, size=9, fill=_FILL_TOTAL)
    ws.merge_cells(f'A{current_row}:E{current_row}')
    total_skip_cols = {18, 23}
    monthly_total_ton_cols = {7, 9, 21, 25}
    for col in range(2, 27):
        col_letter = get_column_letter(col)
        if col >= 6:
            if col in total_skip_cols:
                _apply_style(ws, current_row, col, '', bold=True, size=9, fill=_FILL_TOTAL)
            else:
                parts = [f'{col_letter}{r}' for r in subtotal_rows]
                formula = _excel_round_formula('+'.join(parts) or '0', 3)
                num_fmt = _number_format_for_ton_digits(3) if col in monthly_total_ton_cols else '#,##0.000'
                _apply_style(ws, current_row, col, formula, bold=True, size=9, num_fmt=num_fmt, fill=_FILL_TOTAL)
        else:
            _apply_style(ws, current_row, col, None, bold=True, size=9, fill=_FILL_TOTAL)

    no_fill_cols = {1,2,3,4,6,7,25,26}
    for row in ws.iter_rows(min_row=5, max_row=current_row, max_col=26):
        for cell in row:
            if cell.column in no_fill_cols:
                if not (cell.row in subtotal_rows or cell.row == current_row):
                    cell.fill = PatternFill(fill_type=None)

    _append_closed_station_report_note(ws, current_row, 26)

    actual_days = _completed_report_days(y, m)

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
            business_day as day_date,
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
        total_mass = float(r[14] or 0)
        row_data = {
            'cash_vol': _round_half_up(float(r[2] or 0), 3), 'cash_amt': _round_half_up(float(r[3] or 0), 2),
            'card_vol': _round_half_up(float(r[4] or 0), 3), 'card_amt': _round_half_up(float(r[5] or 0), 2),
            'total_vol': _round_half_up(total_vol, 3), 'total_amt': _round_half_up(float(r[7] or 0), 2),
            'bonus_amt': _round_half_up(bonus_amt, 2), 'bonus_vol': _round_half_up(bonus_vol, 3),
            'avg_price': _round_half_up(avg_price, 2),
            'cash_mass': _round_half_up(float(r[12] or 0), 3),
            'card_mass': _round_half_up(float(r[13] or 0), 3),
            'total_mass': _round_half_up(total_mass, 3),
            'density': _density_from_mass_volume(total_mass, total_vol, r[15] or 0),
        }
        if day_str not in daily_sales_cache:
            daily_sales_cache[day_str] = {}
        if sk not in daily_sales_cache[day_str]:
            daily_sales_cache[day_str][sk] = {}
        if rk not in daily_sales_cache[day_str][sk]:
            daily_sales_cache[day_str][sk][rk] = row_data
        else:
            ex = daily_sales_cache[day_str][sk][rk]
            ex['cash_vol']  = _round_half_up(ex['cash_vol']  + row_data['cash_vol'],  3)
            ex['cash_amt']  = _round_half_up(ex['cash_amt']  + row_data['cash_amt'],  2)
            ex['card_vol']  = _round_half_up(ex['card_vol']  + row_data['card_vol'],  3)
            ex['card_amt']  = _round_half_up(ex['card_amt']  + row_data['card_amt'],  2)
            ex['total_vol'] = _round_half_up(ex['total_vol'] + row_data['total_vol'], 3)
            ex['total_amt'] = _round_half_up(ex['total_amt'] + row_data['total_amt'], 2)
            ex['bonus_amt'] = _round_half_up(ex['bonus_amt'] + row_data['bonus_amt'], 2)
            ex['bonus_vol'] = _round_half_up(ex['bonus_vol'] + row_data['bonus_vol'], 3)
            ex['cash_mass'] = _round_half_up(ex.get('cash_mass', 0) + row_data.get('cash_mass', 0), 3)
            ex['card_mass'] = _round_half_up(ex.get('card_mass', 0) + row_data.get('card_mass', 0), 3)
            ex['total_mass'] = _round_half_up(ex.get('total_mass', 0) + row_data.get('total_mass', 0), 3)
            if ex['total_vol'] > 0:
                ex['avg_price'] = _round_half_up(ex['total_amt'] / ex['total_vol'], 2)
                ex['density'] = _density_from_mass_volume(ex.get('total_mass', 0), ex['total_vol'], ex.get('density', 0))

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
            business_day as day_date,
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
            END,
            business_day
    """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
    daily_ved_cache = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        ds = str(r[3])
        d_day = _daily_metric_map(daily_ved_cache, ds)
        d_sk = d_day.setdefault(sk, {})
        d_sk[rk] = _round_half_up(d_sk.get(rk, 0) + vol, 3)
        key = (sk, rk)
        d_day.mass[key] = _round_half_up(d_day.mass.get(key, 0) + float(r[4] or 0), 3)
        d_day.density[key] = _density_from_mass_volume(d_day.mass[key], d_sk[rk], r[5] or 0)

    cur.execute(f"""
        SELECT ShopKey, ResourceKey, AVG(BasePrice) as avg_price
        FROM {selling_by_business_day}
        WHERE business_day >= %s AND business_day < %s
          AND ResourceKey < 100 AND BasePrice > 0
        GROUP BY ShopKey, ResourceKey
    """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
    supply_price_ref = {(int(r[0]), int(r[1])): float(r[2] or 0) for r in cur.fetchall()}

    supply_mass_expr = _supply_mass_expr()
    cur.execute(f"""
        SELECT ShopKey, ResourceKey, SUM(Volume) as supply_vol,
            AVG(Density) as avg_density,
            DATE(AcceptDateTime) as day_date, ResourceShopKey,
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
        GROUP BY ShopKey, ResourceKey, DATE(AcceptDateTime), ResourceShopKey
    """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
    daily_supply_cache = {}
    for r in cur.fetchall():
        sk = int(r[0])
        orig_rk = int(r[1])
        vol = _round_half_up(float(r[2] or 0), 3)
        avg_density = float(r[3] or 0)
        ds = str(r[4])
        rsk = r[5]
        mass = _round_half_up(float(r[6] or 0), 3)

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
        d_day = _daily_metric_map(daily_supply_cache, ds)
        d_sk = d_day.setdefault(sk, {})
        d_sk[rk] = _round_half_up(d_sk.get(rk, 0) + vol, 3)
        key = (sk, rk)
        d_day.mass[key] = _round_half_up(d_day.mass.get(key, 0) + mass, 3)
        d_day.density[key] = _density_from_mass_volume(d_day.mass[key], d_sk[rk], avg_density)

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
            business_day as day_date,
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
            END,
            business_day
    """, (ym_start + ' 00:00:00', ym_end + ' 00:00:00'))
    daily_contract_cache = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rk = int(r[1])
        if rk < 100:
            continue
        vol = _round_half_up(float(r[2] or 0), 3)
        amt = _round_half_up(float(r[3] or 0), 2)
        contract_price_val = _round_half_up(float(r[4] or 0), 2)
        ds = str(r[5])
        mass = _round_half_up(float(r[6] or 0), 3)
        density = _density_from_mass_volume(mass, vol, r[7] or 0)
        d_sk = daily_contract_cache.setdefault(ds, {}).setdefault(sk, {})
        if rk not in d_sk:
            d_sk[rk] = {'vol': vol, 'amt': amt, 'price': contract_price_val, 'mass': mass, 'density': density}
        else:
            ex = d_sk[rk]
            new_vol = _round_half_up(ex['vol'] + vol, 3)
            new_amt = _round_half_up(ex['amt'] + amt, 2)
            new_mass = _round_half_up(ex.get('mass', 0) + mass, 3)
            d_sk[rk] = {'vol': new_vol, 'amt': new_amt,
                        'price': _round_half_up(new_amt / new_vol, 2) if new_vol > 0 else 0,
                        'mass': new_mass,
                        'density': _density_from_mass_volume(new_mass, new_vol, ex.get('density', density))}

    month_end_str = _exclusive_month_end_date(y, m)
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
        SELECT b.ShopKey, b.ResourceKey,
               b.BeginBalance, {begin_mass_expr}, {begin_density_expr},
               b.EndBalance, {end_mass_expr}, {end_density_expr},
               b.EndBalanceCalculation, b.EndPrice,
               {shift_business_day} as shift_date, b.ResourceShopKey,
               s.DatetimeShiftBegin
        FROM balance b
        JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
        WHERE b.ShopKey IN (%s)
          AND {balance_mass_record_condition}
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
            rk = _infer_resource_code_daily(rk, r[9], rsk=r[11], sk=sk)
        if rk < 100:
            continue
        ds = str(r[10])
        beg = _round_half_up(float(r[2] or 0), 3)
        beg_density = float(r[4] or 0)
        end = _round_half_up(float(r[5] or 0), 3)
        end_density = float(r[7] or 0)
        beg_mass = _mass_from_db_mass_or_density(r[3], beg, beg_density)
        end_mass = _mass_from_db_mass_or_density(r[6], end, end_density)
        end_calc = float(r[8] or 0)
        shift_dt = r[12]
        key = (sk, rk)

        ds_start_dt = daily_start_dt.setdefault(ds, {})
        ds_start = _daily_balance_map(daily_start_cache, ds)
        if key not in ds_start_dt or shift_dt < ds_start_dt[key]:
            ds_start_dt[key] = shift_dt
            ds_start[key] = beg
            ds_start.mass[key] = beg_mass
            ds_start.density[key] = _density_from_mass_volume(beg_mass, beg, beg_density)
        elif shift_dt == ds_start_dt[key]:
            ds_start[key] = _round_half_up(ds_start.get(key, 0) + beg, 3)
            ds_start.mass[key] = _round_half_up(ds_start.mass.get(key, 0) + beg_mass, 3)
            ds_start.density[key] = _density_from_mass_volume(ds_start.mass[key], ds_start[key], beg_density)

        ds_end_dt = daily_end_dt.setdefault(ds, {})
        ds_end = _daily_balance_map(daily_bal_cache, ds)
        ds_loss = daily_loss_cache.setdefault(ds, {})
        if key not in ds_end_dt or shift_dt > ds_end_dt[key]:
            ds_end_dt[key] = shift_dt
            ds_end[key] = end
            ds_end.mass[key] = end_mass
            ds_end.density[key] = _density_from_mass_volume(end_mass, end, end_density)
            if sk not in (29, 30):
                ds_loss[key] = _round_half_up(end_calc - end, 3)
        elif shift_dt == ds_end_dt[key]:
            ds_end[key] = _round_half_up(ds_end.get(key, 0) + end, 3)
            ds_end.mass[key] = _round_half_up(ds_end.mass.get(key, 0) + end_mass, 3)
            ds_end.density[key] = _density_from_mass_volume(ds_end.mass[key], ds_end[key], end_density)
            ds_loss[key] = _round_half_up(ds_loss.get(key, 0) + (end_calc - end), 3)

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
            daily_price_cache.setdefault(ds, {})[(sk, rk)] = _round_half_up(float(r[2] or 0), 2)

    cur.execute(f"""
        SELECT b.ShopKey, b.ResourceKey, b.EndPrice,
            {shift_business_day} as shift_date,
            b.ResourceShopKey
        FROM balance b
        JOIN shift s ON b.ShiftKey = s.ShiftKey AND b.ShopKey = s.ShopKey
        WHERE b.ShopKey IN (%s)
          AND {balance_mass_record_condition}
          AND {shift_business_day} >= '%s'
          AND {shift_business_day} < '%s'
        ORDER BY b.ShopKey, s.DatetimeShiftBegin DESC, b.ResourceKey
    """ % (','.join(str(k) for k in station_keys), ym_start, month_end_str))
    bal_price_seen = {}
    for r in cur.fetchall():
        sk = int(r[0])
        rsk = r[4] if len(r) > 4 else None
        rk = _infer_resource_code_daily(int(r[1]), r[2], rsk=rsk, sk=sk)
        ds = str(r[3])
        if float(r[2] or 0) <= 0:
            continue
        seen = bal_price_seen.setdefault(ds, set())
        if (sk, rk) not in seen:
            seen.add((sk, rk))
            daily_price_cache.setdefault(ds, {})[(sk, rk)] = _round_half_up(float(r[2] or 0), 2)

    pre_month_bal = _new_balance_map()
    pre_month_bal_dt = {}
    month_start_dt = datetime(y, m, 1)
    carry_forward_max_age = timedelta(days=3)
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
    """ % (','.join(str(k) for k in station_keys), ym_start))
    for r in cur.fetchall():
        sk, rk = int(r[0]), int(r[1])
        if rk >= 100:
            corrected = STATION_RK_CORRECTIONS.get((sk, rk))
            if corrected:
                rk = corrected
        else:
            rk = _infer_resource_code_daily(rk, r[5], rsk=r[6], sk=sk)
        if rk < 100:
            continue
        key = (sk, rk)
        density = float(r[4] or 0)
        shift_dt = r[7]
        value = _round_half_up(float(r[2] or 0), 3)
        mass = _mass_from_db_mass_or_density(r[3], value, density)
        if sk not in RENOVATION_CARRY_FORWARD_STATIONS and month_start_dt - shift_dt > carry_forward_max_age:
            continue
        if key not in pre_month_bal_dt or shift_dt > pre_month_bal_dt[key]:
            pre_month_bal_dt[key] = shift_dt
            pre_month_bal[key] = value
            pre_month_bal.mass[key] = mass
            pre_month_bal.density[key] = _density_from_mass_volume(mass, pre_month_bal[key], density)
        elif shift_dt == pre_month_bal_dt[key]:
            pre_month_bal[key] = _round_half_up(pre_month_bal[key] + value, 3)
            pre_month_bal.mass[key] = _round_half_up(pre_month_bal.mass.get(key, 0) + mass, 3)
            pre_month_bal.density[key] = _density_from_mass_volume(pre_month_bal.mass[key], pre_month_bal[key], density)

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
        d_start_bal = _new_balance_map()
        for key in set(list(_today_start.keys()) + list(prev_day_bal.keys())):
            if key in _today_start and _today_start[key] > 0:
                d_start_bal[key] = _today_start[key]
                d_start_bal.mass[key] = getattr(_today_start, 'mass', {}).get(key, 0)
                d_start_bal.density[key] = getattr(_today_start, 'density', {}).get(key, 0)
            elif key in prev_day_bal and prev_day_bal[key] > 0:
                d_start_bal[key] = prev_day_bal[key]
                d_start_bal.mass[key] = getattr(prev_day_bal, 'mass', {}).get(key, 0)
                d_start_bal.density[key] = getattr(prev_day_bal, 'density', {}).get(key, 0)
        d_loss = daily_loss_cache.get(day_str, {})
        d_prices = dict(daily_price_cache.get(day_str, {}))
        for _price_key, _price_val in _official_price_list_for_day(day_str).items():
            d_prices.setdefault(_price_key, _price_val)
        d_sales_daily = {}
        for sk_key, rk_dict in d_sales.items():
            d_sales_daily[sk_key] = {}
            for rk_key, val_dict in rk_dict.items():
                new_dict = dict(val_dict)
                actual_price = d_prices.get((sk_key, rk_key), 0)
                if actual_price > 0 and not float(new_dict.get('avg_price') or 0):
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
            station_start_row = current_row_d
            current_row_d = _write_station_block(
                ws_d, current_row_d, sk, info, d_sales_daily, d_ved, d_supply,
                d_start_bal, d_end_bal, contract_data=d_contract,
                loss_data=d_loss, is_monthly=False, fuel_keys=fuel_keys,
                allow_fixed_density_fallback=_allow_fixed_density_fallback(day_str)
            )
            _hide_closed_station_report_rows(ws_d, sk, station_start_row, current_row_d - 1)
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
                formula = _excel_round_formula('+'.join(parts) or '0', 3)
                _apply_style(ws_d, current_row_d, col, formula, bold=True, size=9, num_fmt='#,##0.000', fill=_FILL_TOTAL)

        merged = _new_balance_map()
        for source in (prev_day_bal, d_end_bal):
            for key, value in source.items():
                merged[key] = value
                merged.mass[key] = getattr(source, 'mass', {}).get(key, 0)
                merged.density[key] = getattr(source, 'density', {}).get(key, 0)
        prev_day_bal = merged

        daily_no_fill_cols = {1, 2, 3, 4, 6, 7, 24}
        for row in ws_d.iter_rows(min_row=5, max_row=current_row_d, max_col=24):
            for cell in row:
                if cell.column in daily_no_fill_cols:
                    if not (cell.row in daily_subtotal_rows or cell.row == current_row_d):
                        cell.fill = PatternFill(fill_type=None)

        _append_closed_station_report_note(ws_d, current_row_d, 24)

    yesterday = datetime.now() - timedelta(days=1)
    filename = monthly_report_filename(y, m, yesterday)
    output_dir = Path(EXPORT_DIR) / "monthly" / str(y)
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / filename
    wb.save(filepath)
    last_nonempty_day = _workbook_last_nonempty_day(Path(filepath))
    _record_report_workbook(year_month, Path(filepath), last_nonempty_day)
    single_day_report = _save_single_day_report_from_monthly(filepath, y, m, last_nonempty_day)

    result = {'status': 'ok', 'file': filename, 'path': str(filepath), 'cached': False}
    if single_day_report:
        result.update(single_day_report)
        result["singleDayDownloadUrl"] = f"/api/export/monthly/{year_month}/daily/download"
    return result
