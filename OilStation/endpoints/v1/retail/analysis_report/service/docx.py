import json
import os
import zipfile
from pathlib import Path
from datetime import datetime
from urllib.parse import quote
from xml.sax.saxutils import escape
from endpoints.v1.retail.analysis_report.service.common import (
    _calc_prev_month, _pct, _fmt, _fmt_pct, _date_label, _period_label,
    _docx_report_title, _resource_tons, _month_after, _is_completed_ym, _is_snapshot_writable_ym,
    _ym_for_full_month, _to_float, _station_key_from_cell, _workbook_report_ym,
    _find_report_workbook_for_ym, _report_extras_from_workbook, _merge_report_extras,
    _finalize_report_extras, _month_slices, _inventory_contract_totals, _inventory_contract_totals_for_period,
    _merge_period_dataset, _finalize_period_dataset, _period_dataset_from_month_slices,
    _attach_report_extras, _query_period_dataset, _same_period_previous_year, _comparison_payload,
    _ensure_report_comparison, _month_exclusive_end, _month_dataset, _year_dataset,
    _round_half_up,
    _table_rows, _sum_key, _complete_station_rows, _top_name, _money_short, _volume_short,
    _percent, _rank_class, _resource_js_rows, _region_js_rows, _station_js_rows, _render_html_report,
    _empty_report_extras, _sales_db_config, _exchange_rates_for_period,
    EXPORT_DIR, PROJECT_ROOT, REPORT_EXTRAS_DIR,
)
from export_excel import RESOURCE_DENSITY


def _safe_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _attach_average_rate_cny(data):
    if data.get("kind") != "monthly":
        return data
    exchange_info = data.get("exchangeRates") or {}
    avg_cny = _safe_float(exchange_info.get("avgCny"))
    conversion = {
        "method": "monthly_average_cny_kgs",
        "available": avg_cny > 0,
        "avgCnyKgs": avg_cny if avg_cny > 0 else None,
    }
    data["cnyConversion"] = conversion
    if avg_cny <= 0:
        return data

    summary = data.setdefault("summary", {})
    summary["totalSalesCnyAvg"] = _round_half_up(_safe_float(summary.get("totalSales")) / avg_cny, 2)
    for item in data.get("resources") or []:
        item["amountCnyAvg"] = _round_half_up(_safe_float(item.get("amount")) / avg_cny, 2)
    conversion["resourceAmountCnyTotal"] = _round_half_up(_sum_key(data.get("resources") or [], "amountCnyAvg"), 2)
    return data


def _docx_document_xml(data):
    summary = data["summary"]
    stations = _complete_station_rows(data.get("stations") or [])
    regions = sorted(data.get("regions") or [], key=lambda item: item.get("amount", 0), reverse=True)
    resources = sorted(data.get("resources") or [], key=lambda item: item.get("volume", 0), reverse=True)
    active_stations = [item for item in stations if item["amount"] > 0 or item["volume"] > 0]
    lines = [
        data["title"],
        f"统计期间：{data['queryStart']} 至 {data['queryEndExclusive']}（不含结束日）",
        f"销售金额：{_fmt(summary['totalSales'], 2)} 索姆",
        f"销量：{_fmt(summary['totalLiters'], 2)} 升 / {_fmt(summary['totalTons'], 3)} 吨",
        f"活跃站点：{len(active_stations)} / {len(stations)} 个",
        f"经营判断：最高销售站点为 {_top_name(active_stations)}，最高销售区域为 {_top_name(regions)}，主力油品为 {_top_name(resources, 'volume')}。本报告按零售报表口径生成，只统计已结束班组数据；柴油除 -35 柴油外统一归集为 Д/Т。",
        "油品结构：",
    ]
    for item in resources:
        lines.append(f"{item.get('name')}: {_fmt(item.get('volume'), 2)} 升，{_fmt(item.get('amount'), 2)} 索姆")
    lines.append("区域表现：")
    for item in regions:
        lines.append(f"{item.get('region')}: {_fmt(item.get('volume'), 2)} 升，{_fmt(item.get('amount'), 2)} 索姆")
    lines.append("站点排行（完整站点）：")
    for index, item in enumerate(stations, start=1):
        lines.append(f"{index}. {item.get('name')}（{item.get('short')}）: {_fmt(item.get('volume'), 2)} 升，{_fmt(item.get('amount'), 2)} 索姆")

    body = "".join(
        f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>"
        for line in lines
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>"""


def _docx_document_xml_v2(data):
    summary = data["summary"]
    stations = _complete_station_rows(data.get("stations") or [])
    regions = sorted(data.get("regions") or [], key=lambda item: item.get("amount", 0), reverse=True)
    resources = sorted(data.get("resources") or [], key=lambda item: item.get("volume", 0), reverse=True)
    active_stations = [item for item in stations if item["amount"] > 0 or item["volume"] > 0]
    exchange_info = data.get("exchangeRates") or {}
    cny_conversion = data.get("cnyConversion") or {}
    has_cny_conversion = bool(cny_conversion.get("available"))
    avg_cny_kgs = cny_conversion.get("avgCnyKgs") or exchange_info.get("avgCny")
    total_sales_cny = summary.get("totalSalesCnyAvg")
    period_label = _period_label(data)

    def para(text="", bold=False, size=21, align=None, color="333333", spacing=120):
        ppr = f"<w:pPr><w:spacing w:after=\"{spacing}\"/>"
        if align:
            ppr += f"<w:jc w:val=\"{align}\"/>"
        ppr += "</w:pPr>"
        rpr = (
            f"<w:rPr><w:rFonts w:ascii=\"Microsoft YaHei\" w:hAnsi=\"Microsoft YaHei\" "
            f"w:eastAsia=\"Microsoft YaHei\"/><w:sz w:val=\"{size}\"/><w:color w:val=\"{color}\"/>"
        )
        if bold:
            rpr += "<w:b/>"
        rpr += "</w:rPr>"
        parts = str(text).split("\n")
        text_xml = "<w:br/>".join(f"<w:t>{escape(part)}</w:t>" for part in parts)
        return f"<w:p>{ppr}<w:r>{rpr}{text_xml}</w:r></w:p>"

    def heading(text):
        return para(text, bold=True, size=28, color="1A3A5C", spacing=160)

    def cell(text, bold=False, shade=None, align="center", width=None):
        width_xml = f"<w:tcW w:w=\"{width}\" w:type=\"dxa\"/>" if width else "<w:tcW w:w=\"0\" w:type=\"auto\"/>"
        tcpr = f"<w:tcPr>{width_xml}<w:vAlign w:val=\"center\"/>"
        if shade:
            tcpr += f"<w:shd w:fill=\"{shade}\"/>"
        tcpr += "</w:tcPr>"
        color = "FFFFFF" if shade else "333333"
        return f"<w:tc>{tcpr}{para(text, bold=bold, size=18, color=color, spacing=0, align=align)}</w:tc>"

    def table(headers, rows, widths=None):
        rows = rows or [["--"] * len(headers)]
        widths = widths or [None] * len(headers)
        body = [
            "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/>"
            "<w:tblW w:w=\"9026\" w:type=\"dxa\"/><w:jc w:val=\"center\"/>"
            "<w:tblLayout w:type=\"autofit\"/>"
            "<w:tblBorders>"
            "<w:top w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "<w:left w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "<w:bottom w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "<w:right w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "<w:insideH w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "<w:insideV w:val=\"single\" w:sz=\"4\" w:color=\"D9E2EC\"/>"
            "</w:tblBorders></w:tblPr>"
        ]
        body.append("<w:tr>" + "".join(cell(header, bold=True, shade="1A3A5C", width=widths[index]) for index, header in enumerate(headers)) + "</w:tr>")
        for row in rows:
            is_total = bool(row) and str(row[0]) == "合计"
            body.append("<w:tr>" + "".join(cell(value, bold=is_total, width=widths[index] if index < len(widths) else None) for index, value in enumerate(row)) + "</w:tr>")
        body.append("</w:tbl>")
        return "".join(body) + para("", spacing=100)

    def station_name_lines(item):
        name = item.get("name") or "--"
        short = item.get("short") or ""
        return f"{name}\n{short}" if short else name

    def region_name_lines(name):
        name = str(name or "--")
        if len(name) > 4 and name[-1] in ("州", "市"):
            return f"{name[:-1]}\n{name[-1]}"
        return name

    total_sales = float(summary.get("totalSales") or 0)
    cash_sales = float(summary.get("cashSales") or 0)
    card_sales = float(summary.get("cardSales") or 0)
    end_inventory = float(summary.get("endInventory") or 0)
    end_inventory_tons = float(summary.get("endInventoryTons") or 0)
    cny_note_parts = []
    if has_cny_conversion:
        cny_note_parts = [
            para(
                f"• 人民币金额按本月平均 CNY/KGS {_fmt(avg_cny_kgs, 4)} 统一折算，"
                "公式为索姆金额 ÷ 月平均汇率。",
                spacing=60,
            )
        ]
    overview_rows = [
        ["销售量（升）", _fmt(summary.get("totalLiters"), 2), "折算吨数", _fmt(summary.get("totalTons"), 3)],
    ]
    if has_cny_conversion:
        overview_rows.extend([
            ["销售金额（索姆）", _fmt(summary.get("totalSales"), 2), "折算人民币（元）", _fmt(total_sales_cny, 2)],
            ["期末库存（升）", _fmt(end_inventory, 2), "期末库存（吨）", _fmt(end_inventory_tons, 3)],
        ])
    else:
        overview_rows.extend([
            ["销售金额（索姆）", _fmt(summary.get("totalSales"), 2), "期末库存（升）", _fmt(end_inventory, 2)],
            ["期末库存（吨）", _fmt(end_inventory_tons, 3), "活跃站点", f"{len(active_stations)} / {len(stations)}"],
        ])
    overview_rows.append(["现金占比", _percent(cash_sales, total_sales), "刷卡占比", _percent(card_sales, total_sales)])

    resource_headers = ["油品", "销量（升）", "销售金额（索姆）"]
    if has_cny_conversion:
        resource_headers.append("折算人民币（元）")
    resource_headers.append("销量占比")
    resource_rows = []
    for item in resources:
        row = [
            item.get("name") or "--",
            _fmt(item.get("volume"), 2),
            _fmt(item.get("amount"), 2),
        ]
        if has_cny_conversion:
            row.append(_fmt(item.get("amountCnyAvg"), 2))
        row.append(_percent(item.get("volume"), summary.get("totalLiters")))
        resource_rows.append(row)
    if resources:
        total_row = [
            "合计",
            _fmt(_sum_key(resources, "volume"), 2),
            _fmt(_sum_key(resources, "amount"), 2),
        ]
        if has_cny_conversion:
            total_row.append(_fmt(_sum_key(resources, "amountCnyAvg"), 2))
        total_row.append(_percent(_sum_key(resources, "volume"), summary.get("totalLiters")))
        resource_rows.append(total_row)

    exchange_text = (
        f"本统计周期已获取 {exchange_info.get('count', 0)} / {exchange_info.get('totalDays', 0)} 天汇率快照。"
        f"平均 USD/KGS：{_fmt(exchange_info.get('avgUsd'), 4) if exchange_info.get('avgUsd') is not None else '--'}；"
        f"平均 CNY/KGS：{_fmt(exchange_info.get('avgCny'), 4) if exchange_info.get('avgCny') is not None else '--'}。"
    )
    if has_cny_conversion:
        exchange_text += (
            f"本报告人民币金额按本月平均 CNY/KGS {_fmt(avg_cny_kgs, 4)} 统一折算，"
            f"本期销售额折算人民币 {_fmt(total_sales_cny, 2)} 元。"
        )
    month_compare_parts = []
    yearly_trend_parts = []
    if data["kind"] == "monthly":
        comparison = data.get("comparison") or {}
        month_compare_parts = [
            heading(f"同比环比分析（{data.get('month')}月 vs {comparison.get('prevLabel') or '上月'} / {comparison.get('yoyLabel') or '上年同期'}）"),
            table(
                ["指标", "本期", "环比", "同比"],
                [
                    ["销售总量", f"{_fmt(summary.get('totalLiters'), 2)} 升", _fmt_pct(comparison.get("momVolume")), _fmt_pct(comparison.get("yoyVolume"))],
                    ["销售金额", f"{_fmt(summary.get('totalSales'), 2)} 索姆", _fmt_pct(comparison.get("momSales")), _fmt_pct(comparison.get("yoySales"))],
                    ["现金支付", f"{_fmt(cash_sales, 2)} 索姆", _fmt_pct(comparison.get("momCash")), _fmt_pct(comparison.get("yoyCash"))],
                    ["刷卡支付", f"{_fmt(card_sales, 2)} 索姆", _fmt_pct(comparison.get("momCard")), _fmt_pct(comparison.get("yoyCard"))],
                ],
            ),
            para(
                f"本期销售总量环比 {_fmt_pct(comparison.get('momVolume'))}、同比 {_fmt_pct(comparison.get('yoyVolume'))}；"
                f"销售金额环比 {_fmt_pct(comparison.get('momSales'))}、同比 {_fmt_pct(comparison.get('yoySales'))}。"
                f"刷卡支付占比 {_percent(card_sales, total_sales)}，现金支付占比 {_percent(cash_sales, total_sales)}；"
                f"合同销售量 {_fmt(summary.get('contractVolume'), 2)} 升，已计入总销售量。"
            ),
        ]
    yearly_compare_parts = []
    if data["kind"] == "yearly":
        comparison = data.get("comparison") or {}
        yearly_compare_parts = [
            heading(f"三、同比分析（本年累计 vs {comparison.get('yoyLabel') or '上年同期'}）"),
            table(
                ["指标", "本年累计", "同比"],
                [
                    ["销售总量", f"{_fmt(summary.get('totalLiters'), 2)} 升", _fmt_pct(comparison.get("yoyVolume"))],
                    ["销售金额", f"{_fmt(summary.get('totalSales'), 2)} 索姆", _fmt_pct(comparison.get("yoySales"))],
                    ["现金支付", f"{_fmt(cash_sales, 2)} 索姆", _fmt_pct(comparison.get("yoyCash"))],
                    ["刷卡支付", f"{_fmt(card_sales, 2)} 索姆", _fmt_pct(comparison.get("yoyCard"))],
                ],
            ),
        ]
        yearly_trend_parts = [
            heading("四、月度趋势"),
            table(
                ["月份", "销量（升）", "折算吨数", "销售金额（索姆）"],
                [[
                    f"{item.get('month')}月",
                    _fmt(item.get("volume"), 2),
                    _fmt(item.get("tons"), 3),
                    _fmt(item.get("amount"), 2),
                ] for item in data.get("monthly", [])] + ([[
                    "合计",
                    _fmt(_sum_key(data.get("monthly", []), "volume"), 2),
                    _fmt(_sum_key(data.get("monthly", []), "tons"), 3),
                    _fmt(_sum_key(data.get("monthly", []), "amount"), 2),
                ]] if data.get("monthly") else []),
                [1200, 2400, 1800, 2600],
            ),
        ]
    overview_heading = "五、经营概览" if data["kind"] == "yearly" else "三、经营概览"
    resource_heading = "六、油品结构明细" if data["kind"] == "yearly" else "四、油品结构明细"
    region_heading = "七、区域表现明细" if data["kind"] == "yearly" else "五、区域表现明细"
    station_heading = "八、加油站销售数据明细（按销售量排序）" if data["kind"] == "yearly" else "六、加油站销售数据明细（按销售量排序）"
    conclusion_heading = "九、核心结论" if data["kind"] == "yearly" else "七、核心结论"
    exchange_heading = "十、汇率信息" if data["kind"] == "yearly" else "八、汇率信息"
    body_parts = [
        para("Example石油公司零售板块", bold=True, size=36, align="center", color="1A3A5C", spacing=120),
        para(_docx_report_title(data), bold=True, size=32, align="center", color="1A3A5C", spacing=120),
        para(f"统计周期：{period_label}", align="center", color="667085", size=21, spacing=220),
        heading("一、报告概述"),
        para(
            f"本报告基于Example石油公司零售板块{data.get('periodLabel')}销售数据，对加油站经营情况进行系统分析。"
            "统计结果按零售报表同一口径生成，只统计已结束班组数据。",
            spacing=100,
        ),
        para("统计口径说明：", bold=True, spacing=80),
        para("• 总销量包含普通销售、刷卡销售及合同销售。", spacing=60),
        para("• 总销售额按销售现金、刷卡金额及合同金额统计。", spacing=60),
        para("• 吨数按系统密度快照折算。", spacing=140),
        *cny_note_parts,
        heading("二、全网经营总览"),
        table(
            ["指标", "数值", "指标", "数值"],
            overview_rows,
        ),
        *month_compare_parts,
        *yearly_compare_parts,
        *yearly_trend_parts,
        heading(overview_heading),
        para(
            f"本期销售总量为 {_fmt(summary.get('totalLiters'), 2)} 升，折算 {_fmt(summary.get('totalTons'), 3)} 吨，"
            f"销售金额 {_fmt(summary.get('totalSales'), 2)} 索姆"
            f"{'，折算人民币 ' + _fmt(total_sales_cny, 2) + ' 元' if has_cny_conversion else ''}。"
            f"销售金额最高站点为 {_top_name(active_stations)}，"
            f"贡献最高区域为 {_top_name(regions)}，主力油品为 {_top_name(resources, 'volume')}。"
        ),
        para("本报告按零售报表口径生成，只统计已结束班组数据；吨数按系统密度快照折算。"),
        heading(resource_heading),
        table(
            resource_headers,
            resource_rows,
        ),
        heading(region_heading),
        table(
            ["区域", "销量（升）", "销售金额（索姆）", "金额占比", "站点数"],
            [[
                item.get("region") or "--",
                _fmt(item.get("volume"), 2),
                _fmt(item.get("amount"), 2),
                _percent(item.get("amount"), total_sales),
                item.get("stationCount", 0),
            ] for item in regions] + ([[
                "合计",
                _fmt(_sum_key(regions, "volume"), 2),
                _fmt(_sum_key(regions, "amount"), 2),
                _percent(_sum_key(regions, "amount"), total_sales),
                sum(int(item.get("stationCount") or 0) for item in regions),
            ]] if regions else []),
        ),
        heading(station_heading),
        table(
            ["排名", "加油站", "区域", "销售总量（升）", "合同量（升）", "销售金额（索姆）", "现金", "刷卡", "期末库存（升）"],
            [[
                index,
                station_name_lines(item),
                region_name_lines(item.get("region")),
                _fmt(item.get("volume"), 2),
                _fmt(item.get("contractVolume"), 2) if item.get("contractVolume") else "--",
                _fmt(item.get("amount"), 2),
                _fmt(item.get("cashSales") or item.get("cash"), 2),
                _fmt(item.get("cardSales") or item.get("card"), 2),
                _fmt(item.get("endInventory"), 2) if item.get("endInventory") else "--",
            ] for index, item in enumerate(sorted(stations, key=lambda row: row.get("volume") or 0, reverse=True), start=1)] + ([[
                "合计",
                "全部加油站",
                "全部区域",
                _fmt(_sum_key(stations, "volume"), 2),
                _fmt(_sum_key(stations, "contractVolume"), 2),
                _fmt(_sum_key(stations, "amount"), 2),
                _fmt(_sum_key(stations, "cashSales"), 2),
                _fmt(_sum_key(stations, "cardSales"), 2),
                _fmt(_sum_key(stations, "endInventory"), 2),
            ]] if stations else []),
            [520, 1450, 860, 1080, 880, 1220, 1080, 1080, 1080],
        ),
        heading(conclusion_heading),
        table(
            ["经营亮点", "关注风险", "综合评价"],
            [[
                f"销售最高站点为 {_top_name(active_stations)}；主力油品为 {_top_name(resources, 'volume')}。",
                "低销量或无销量站点需结合后台站点状态、库存和班组完成情况复核。",
                "本报告按报表同一口径生成，适合作为月度/年度经营分析留档。",
            ]],
        ),
        heading(exchange_heading),
        para(exchange_text),
    ]
    body = "".join(body_parts)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>"""


def _write_docx(path, data):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""")
        zf.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""")
        zf.writestr("word/document.xml", _docx_document_xml_v2(data))


def _write_reports(data):
    data = _ensure_report_comparison(data)
    data["exchangeRates"] = _exchange_rates_for_period(data.get("queryStart"), data.get("queryEndExclusive"))
    data = _attach_average_rate_cny(data)
    data = _attach_report_extras(data)
    base_name = data["title"]
    html_name = f"{base_name}.html"
    docx_name = f"{base_name}.docx"
    html_path = os.path.join(EXPORT_DIR, html_name)
    docx_path = os.path.join(EXPORT_DIR, docx_name)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(_render_html_report(data))
    _write_docx(docx_path, data)
    return {
        "htmlFile": html_name,
        "docxFile": docx_name,
        "htmlViewUrl": f"/api/export/analysis/view/{quote(html_name)}",
        "htmlDownloadUrl": f"/api/export/analysis/download/{quote(html_name)}",
        "docxDownloadUrl": f"/api/export/analysis/download/{quote(docx_name)}",
    }
