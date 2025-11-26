from __future__ import annotations

import json
import mimetypes
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pymysql
from flask import jsonify, request, send_file
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.utils import secure_filename

from api_v2 import bp_v2
from db import get_connection
from .permission_service import ensure_permission_schema, get_effective_auth, has_permission


PROJECT_ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_UPLOAD_ROOT = PROJECT_ROOT / "knowledge_uploads"
KNOWLEDGE_SEARCH_KEYWORDS = (
    "报表中心", "报表", "模板", "分享", "导出", "下载",
    "零售", "批发", "合同", "称重", "支付方式", "现金", "刷卡", "金额", "单位", "万", "索姆",
    "权限", "角色", "数据范围", "账号", "密码", "强制改密", "首次登录",
    "客户端", "外网", "安装", "更新", "自动更新", "版本",
    "AI", "助手", "知识库", "只读", "引用", "本地大模型",
    "首页", "地图", "可视化", "安全", "巡检",
)


def _safe_execute(cur, sql: str, params: tuple[Any, ...] | None = None) -> None:
    cur.execute(sql, params or ())


def ensure_knowledge_schema(cur) -> None:
    ensure_permission_schema(cur)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS knowledge_spaces (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            space_key VARCHAR(64) NOT NULL UNIQUE,
            space_name VARCHAR(128) NOT NULL,
            description VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NULL,
            updated_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_active_order (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS knowledge_categories (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            space_id BIGINT NOT NULL,
            parent_id BIGINT NULL,
            category_name VARCHAR(128) NOT NULL,
            description VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_space_active (space_id, is_active, sort_order),
            KEY idx_parent (parent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS knowledge_articles (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            space_id BIGINT NOT NULL,
            category_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            summary VARCHAR(1000) NULL,
            content LONGTEXT NULL,
            content_format VARCHAR(32) NOT NULL DEFAULT 'markdown',
            article_type VARCHAR(64) NOT NULL DEFAULT 'article',
            status VARCHAR(32) NOT NULL DEFAULT 'published',
            module_key VARCHAR(64) NULL,
            tags_json LONGTEXT NULL,
            visible_role_codes LONGTEXT NULL,
            visible_department_ids LONGTEXT NULL,
            allow_ai BOOLEAN NOT NULL DEFAULT TRUE,
            view_count BIGINT NOT NULL DEFAULT 0,
            created_by BIGINT NULL,
            updated_by BIGINT NULL,
            published_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_space_status (space_id, status, updated_at),
            KEY idx_category_status (category_id, status, updated_at),
            KEY idx_module_status (module_key, status),
            FULLTEXT KEY ft_article_text (title, summary, content)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS knowledge_article_versions (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            article_id BIGINT NOT NULL,
            version_no INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            summary VARCHAR(1000) NULL,
            content LONGTEXT NULL,
            tags_json LONGTEXT NULL,
            status VARCHAR(32) NOT NULL,
            module_key VARCHAR(64) NULL,
            allow_ai BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_article_version (article_id, version_no),
            KEY idx_article_created (article_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS knowledge_attachments (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            article_id BIGINT NOT NULL,
            original_name VARCHAR(255) NOT NULL,
            stored_name VARCHAR(255) NOT NULL,
            file_size BIGINT NOT NULL DEFAULT 0,
            mime_type VARCHAR(128) NULL,
            uploaded_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_article (article_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _seed_knowledge_catalog(cur)


def _seed_knowledge_catalog(cur) -> None:
    spaces = [
        ("sales_platform", "项目知识库", "系统操作、数据口径、接口说明与常见问题", 10),
        ("retail", "零售知识库", "零售业务操作、报表说明与异常处理", 20),
        ("wholesale", "批发知识库", "批发业务、合同、称重与客户规则", 30),
        ("reports", "报表与分析", "现有报表模板、指标口径与分享说明", 40),
        ("operations", "运维与安全", "部署、备份、权限、安全巡检与故障处理", 50),
        ("company_work", "综合工作资料", "可沉淀其他工作中常用的流程、制度和资料", 60),
    ]
    for key, name, desc, order in spaces:
        _safe_execute(cur, """
            INSERT INTO knowledge_spaces (space_key, space_name, description, sort_order, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
            ON DUPLICATE KEY UPDATE
                space_name = VALUES(space_name),
                description = VALUES(description),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        """, (key, name, desc, order))

    _safe_execute(cur, "SELECT id, space_key FROM knowledge_spaces")
    space_ids = {row["space_key"]: row["id"] for row in cur.fetchall()}
    categories = [
        ("sales_platform", "操作手册", "系统日常操作说明", 10),
        ("sales_platform", "数据口径", "指标、字段、报表口径说明", 20),
        ("sales_platform", "常见问题", "登录、权限、客户端和数据异常处理", 30),
        ("retail", "零售报表", "零售日报、月报、区域与站点分析", 10),
        ("wholesale", "批发流程", "客户、油品、外运与称重审核流程", 10),
        ("reports", "模板说明", "已固化报表模板的使用和维护说明", 10),
        ("operations", "安全运行", "账号、权限、备份、巡检与故障恢复", 10),
        ("company_work", "通用资料", "项目外工作资料和经验沉淀", 10),
    ]
    for space_key, name, desc, order in categories:
        space_id = space_ids.get(space_key)
        if not space_id:
            continue
        _safe_execute(cur, """
            SELECT id FROM knowledge_categories
            WHERE space_id = %s AND category_name = %s LIMIT 1
        """, (space_id, name))
        if cur.fetchone():
            continue
        _safe_execute(cur, """
            INSERT INTO knowledge_categories (space_id, category_name, description, sort_order, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
        """, (space_id, name, desc, order))

    _seed_initial_articles(cur, space_ids)


def _seed_initial_articles(cur, space_ids: dict[str, int]) -> None:
    _safe_execute(cur, """
        SELECT c.id, c.category_name, s.space_key
        FROM knowledge_categories c
        JOIN knowledge_spaces s ON s.id = c.space_id
    """)
    category_ids = {(row["space_key"], row["category_name"]): row["id"] for row in cur.fetchall()}
    seeds = [
        {
            "space": "sales_platform",
            "category": "常见问题",
            "title": "账号首次登录与强制改密说明",
            "summary": "所有由管理员创建或重置密码的账号，首次登录后都必须先修改密码。",
            "content": """# 账号首次登录与强制改密说明

本项目不开放用户自行注册，账号统一由管理员创建。由于初始密码通常采用统一规则，所有账号首次登录时都必须先完成密码修改。

适用规则：

- 管理员创建的新账号，首次登录必须修改密码。
- 管理员重置密码后的账号，再次登录也必须修改密码。
- 未完成改密前，只允许访问当前账号信息和修改密码接口，其他业务接口会被拦截。
- 改密完成后，账号按已分配角色和权限正常访问系统。
""",
            "type": "faq",
            "module": "auth",
            "tags": ["账号", "密码", "强制改密", "首次登录", "安全"],
        },
        {
            "space": "reports",
            "category": "模板说明",
            "title": "报表中心统一入口使用说明",
            "summary": "报表中心只做统一入口和权限控制，现有模板本身保持原有格式与口径。",
            "content": """# 报表中心统一入口使用说明

报表中心用于集中管理和下载已经完善的报表与分析报告模板，不替换现有模板逻辑。

使用原则：

- 报表模板继续沿用原有格式、字段和口径。
- 报表中心负责统一入口、菜单权限、下载入口和后续分享入口。
- 零售、批发等业务页面布局暂时不重做，只统一 API、权限和视觉细节。
- 新增模板时，优先补充模板说明、适用范围、数据口径和下载权限。
""",
            "type": "manual",
            "module": "reports",
            "tags": ["报表中心", "模板", "下载", "分享", "权限"],
        },
        {
            "space": "retail",
            "category": "零售报表",
            "title": "零售报表口径与支付方式单位说明",
            "summary": "零售报表金额按索姆统计，部分汇总表为了阅读方便按万索姆展示。",
            "content": """# 零售报表口径与支付方式单位说明

零售报表金额底层按索姆保存和计算，页面汇总展示时会根据场景转换为万索姆。

重点口径：

- 销售金额、现金、刷卡和合计金额来自零售月度数据。
- 报表菜单的“按支付方式”表中，现金、刷卡、合计金额统一按“万 сом”展示。
- 刷卡比例 = 刷卡金额 / 总销售金额。
- 若站点当月无销售金额，比例显示为占位符，避免误导。
""",
            "type": "metric",
            "module": "retail",
            "tags": ["零售", "报表", "支付方式", "现金", "刷卡", "金额", "单位"],
        },
        {
            "space": "wholesale",
            "category": "批发流程",
            "title": "批发数据与合同匹配口径",
            "summary": "批发查询、称重审核和合同管理应围绕客户、油品、日期、吨数和金额保持口径一致。",
            "content": """# 批发数据与合同匹配口径

批发板块的核心是让查询、称重审核、合同和报表口径一致。

建议口径：

- 客户、油品、发货日期、吨数和金额是主要匹配字段。
- 合同页面负责合同基础信息和附件编号维护。
- 称重审核负责实际发货和收货数据确认。
- 报表统计优先引用已审核、已确认的数据，避免草稿或异常行进入正式统计。
""",
            "type": "metric",
            "module": "wholesale",
            "tags": ["批发", "合同", "称重", "客户", "金额"],
        },
        {
            "space": "operations",
            "category": "安全运行",
            "title": "权限管理基础说明",
            "summary": "权限应按菜单、操作按钮、导出能力和数据范围分层控制。",
            "content": """# 权限管理基础说明

权限管理建议按“角色 + 权限点 + 数据范围”组合维护。

管理重点：

- 菜单权限决定用户能看到哪些页面。
- 操作权限决定新增、编辑、删除、导出等按钮是否可用。
- 数据范围决定用户能查看哪些站点、区域、客户或部门数据。
- 管理员创建账号后，应先分配角色和必要的数据范围，再交付用户首次登录改密。
""",
            "type": "policy",
            "module": "roles",
            "tags": ["权限", "角色", "数据范围", "安全"],
        },
        {
            "space": "sales_platform",
            "category": "操作手册",
            "title": "AI 助手只读边界与知识库引用",
            "summary": "AI 助手可以引用知识库回答问题，但不能替用户执行写入、删除、刷新缓存等操作。",
            "content": """# AI 助手只读边界与知识库引用

AI 助手定位为只读问答和分析入口。

允许范围：

- 查询用户有权限查看的业务数据摘要。
- 引用已发布且允许 AI 引用的知识库文章。
- 解释报表口径、菜单位置、常见问题和操作步骤。

禁止范围：

- 不允许直接新增、修改、删除业务数据。
- 不允许刷新缓存、执行系统命令或修改文件。
- 不允许绕过当前账号的权限查看资料。
""",
            "type": "policy",
            "module": "assistant",
            "tags": ["AI", "助手", "知识库", "只读", "引用"],
        },
        {
            "space": "operations",
            "category": "安全运行",
            "title": "外网客户端更新与本地验收流程",
            "summary": "每次客户端修复或新增后，先打开本地 Electron 客户端检查，通过后再打包部署。",
            "content": """# 外网客户端更新与本地验收流程

客户端用于外网电脑安装使用，不能每次改动后直接覆盖下载目录。

约定流程：

- 修复或新增完成后，先启动本地 Electron 客户端给用户检查。
- 用户确认没问题后，再升级版本、打包安装包并更新下载目录。
- 本地验收阶段不覆盖外网下载目录的安装包和 latest.yml。
- 涉及后端逻辑时，先完成接口、权限和关键页面验证。
""",
            "type": "manual",
            "module": "updates",
            "tags": ["客户端", "外网", "更新", "版本", "本地验收"],
        },
        {
            "space": "company_work",
            "category": "通用资料",
            "title": "通用工作资料沉淀建议",
            "summary": "知识库不仅保存项目资料，也可以逐步沉淀其他工作中的流程、制度和经验。",
            "content": """# 通用工作资料沉淀建议

知识库最终可以覆盖项目资料和其他工作资料。

建议分类：

- 项目资料：系统操作、接口口径、报表说明、权限规则。
- 业务资料：客户规则、流程制度、常用模板、异常处理。
- 运维资料：部署记录、更新流程、巡检清单、安全注意事项。
- 经验资料：问题复盘、常见问答、培训材料和临时说明。

资料进入知识库时，应补充标题、摘要、标签、空间分类和是否允许 AI 引用。
""",
            "type": "manual",
            "module": "knowledge",
            "tags": ["知识库", "工作资料", "流程", "归档"],
        },
    ]
    for item in seeds:
        space_id = space_ids.get(item["space"])
        if not space_id:
            continue
        _safe_execute(cur, """
            SELECT id FROM knowledge_articles
            WHERE space_id = %s AND title = %s
            LIMIT 1
        """, (space_id, item["title"]))
        if cur.fetchone():
            continue
        category_id = category_ids.get((item["space"], item["category"]))
        tags_json = _json_dumps(item["tags"])
        _safe_execute(cur, """
            INSERT INTO knowledge_articles (
                space_id, category_id, title, summary, content, content_format, article_type,
                status, module_key, tags_json, visible_role_codes, visible_department_ids,
                allow_ai, published_at
            )
            VALUES (%s, %s, %s, %s, %s, 'markdown', %s, 'published', %s, %s, '[]', '[]', TRUE, NOW())
        """, (
            space_id,
            category_id,
            item["title"],
            item["summary"],
            item["content"],
            item["type"],
            item["module"],
            tags_json,
        ))
        article_id = cur.lastrowid
        _safe_execute(cur, """
            INSERT INTO knowledge_article_versions (
                article_id, version_no, title, summary, content, tags_json, status,
                module_key, allow_ai, created_by
            )
            VALUES (%s, 1, %s, %s, %s, %s, 'published', %s, TRUE, NULL)
        """, (
            article_id,
            item["title"],
            item["summary"],
            item["content"],
            tags_json,
            item["module"],
        ))


def _json_list(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _json_dumps(value: Any) -> str:
    if value is None:
        value = []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            value = parsed if isinstance(parsed, list) else [value]
        except Exception:
            value = [item.strip() for item in value.split(",") if item.strip()]
    if not isinstance(value, list):
        value = []
    return json.dumps(value, ensure_ascii=False)


def _search_terms(query: str, limit: int = 8) -> list[str]:
    text = str(query or "").strip()
    if not text:
        return []
    raw_terms = [item.strip() for item in re.split(r"\s+", text) if item.strip()]
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        value = term.strip()
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            terms.append(value)

    if len(raw_terms) > 1:
        for item in raw_terms:
            add(item[:32])
    elif raw_terms and re.search(r"[A-Za-z0-9_./:-]", raw_terms[0]):
        add(raw_terms[0][:32])

    lowered = text.lower()
    for keyword in KNOWLEDGE_SEARCH_KEYWORDS:
        if keyword.lower() in lowered:
            add(keyword)

    if not terms and raw_terms:
        add(raw_terms[0][:24])
    return terms[:limit]


def _time_text(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return str(value) if value else None


def _current_user(cur) -> dict[str, Any] | None:
    user_id = int(get_jwt_identity())
    _safe_execute(cur, """
        SELECT id, username, display_name, role
        FROM system_users
        WHERE id = %s AND is_active = TRUE
    """, (user_id,))
    user = cur.fetchone()
    if not user:
        return None
    auth = get_effective_auth(cur, user["id"], user["role"])
    user["roles"] = auth.get("roles", [])
    user["departments"] = auth.get("departments", [])
    user["permissionCodes"] = auth.get("permissionCodes", [])
    return user


def _forbidden(message: str = "forbidden"):
    return jsonify({"code": 4003, "message": message, "data": None}), 403


def _require_view(cur) -> tuple[dict[str, Any] | None, Any]:
    user = _current_user(cur)
    if not user:
        return None, (jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401)
    if user["role"] == "admin" or has_permission(cur, user["id"], "knowledge:view", user["role"]):
        return user, None
    return None, _forbidden()


def _can_manage(cur, user: dict[str, Any]) -> bool:
    return user["role"] == "admin" or has_permission(cur, user["id"], "knowledge:manage", user["role"])


def _can_delete_attachment(user: dict[str, Any]) -> bool:
    return user["role"] == "admin"


def _role_codes(user: dict[str, Any]) -> set[str]:
    codes = {str(user.get("role") or "")}
    codes.update(str(item.get("roleCode") or "") for item in user.get("roles", []))
    return {code for code in codes if code}


def _department_ids(user: dict[str, Any]) -> set[int]:
    ids: set[int] = set()
    for item in user.get("departments", []):
        try:
            ids.add(int(item.get("id")))
        except Exception:
            continue
    return ids


def _article_visible(row: dict[str, Any], user: dict[str, Any]) -> bool:
    if user.get("role") == "admin":
        return True
    role_rules = {str(item) for item in _json_list(row.get("visible_role_codes")) if str(item)}
    dept_rules = set()
    for item in _json_list(row.get("visible_department_ids")):
        try:
            dept_rules.add(int(item))
        except Exception:
            continue
    if not role_rules and not dept_rules:
        return True
    return bool(role_rules & _role_codes(user) or dept_rules & _department_ids(user))


def _article_row_to_item(row: dict[str, Any], include_content: bool = False) -> dict[str, Any]:
    item = {
        "id": row["id"],
        "spaceId": row["space_id"],
        "spaceName": row.get("space_name"),
        "categoryId": row.get("category_id"),
        "categoryName": row.get("category_name"),
        "title": row["title"],
        "summary": row.get("summary") or "",
        "contentFormat": row.get("content_format") or "markdown",
        "articleType": row.get("article_type") or "article",
        "status": row.get("status") or "draft",
        "moduleKey": row.get("module_key") or "",
        "tags": _json_list(row.get("tags_json")),
        "visibleRoleCodes": _json_list(row.get("visible_role_codes")),
        "visibleDepartmentIds": _json_list(row.get("visible_department_ids")),
        "allowAi": bool(row.get("allow_ai")),
        "viewCount": int(row.get("view_count") or 0),
        "createdBy": row.get("created_by"),
        "updatedBy": row.get("updated_by"),
        "createdAt": _time_text(row.get("created_at")),
        "updatedAt": _time_text(row.get("updated_at")),
        "publishedAt": _time_text(row.get("published_at")),
    }
    if include_content:
        item["content"] = row.get("content") or ""
    return item


def _attachment_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "articleId": row["article_id"],
        "originalName": row["original_name"],
        "fileSize": int(row.get("file_size") or 0),
        "mimeType": row.get("mime_type"),
        "createdAt": _time_text(row.get("created_at")),
    }


def _version_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "articleId": row["article_id"],
        "versionNo": row["version_no"],
        "title": row["title"],
        "summary": row.get("summary") or "",
        "status": row.get("status") or "draft",
        "moduleKey": row.get("module_key") or "",
        "allowAi": bool(row.get("allow_ai")),
        "createdBy": row.get("created_by"),
        "createdAt": _time_text(row.get("created_at")),
    }


def _select_article(cur, article_id: int) -> dict[str, Any] | None:
    _safe_execute(cur, """
        SELECT a.*, s.space_name, c.category_name
        FROM knowledge_articles a
        JOIN knowledge_spaces s ON s.id = a.space_id
        LEFT JOIN knowledge_categories c ON c.id = a.category_id
        WHERE a.id = %s
    """, (article_id,))
    return cur.fetchone()


def _record_version(cur, article_id: int, user_id: int | None) -> None:
    row = _select_article(cur, article_id)
    if not row:
        return
    _safe_execute(cur, "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM knowledge_article_versions WHERE article_id = %s", (article_id,))
    version_no = int((cur.fetchone() or {}).get("next_no") or 1)
    _safe_execute(cur, """
        INSERT INTO knowledge_article_versions
            (article_id, version_no, title, summary, content, tags_json, status, module_key, allow_ai, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        article_id,
        version_no,
        row.get("title"),
        row.get("summary"),
        row.get("content"),
        row.get("tags_json"),
        row.get("status"),
        row.get("module_key"),
        1 if row.get("allow_ai") else 0,
        user_id,
    ))


def _article_payload(data: dict[str, Any]) -> dict[str, Any]:
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValueError("title_required")
    status = str(data.get("status") or "published").strip() or "published"
    if status not in {"draft", "published", "archived"}:
        status = "draft"
    article_type = str(data.get("articleType") or data.get("article_type") or "article").strip() or "article"
    return {
        "space_id": int(data.get("spaceId") or data.get("space_id") or 0),
        "category_id": int(data.get("categoryId") or data.get("category_id") or 0) or None,
        "title": title,
        "summary": str(data.get("summary") or "").strip(),
        "content": str(data.get("content") or ""),
        "content_format": str(data.get("contentFormat") or data.get("content_format") or "markdown").strip() or "markdown",
        "article_type": article_type[:64],
        "status": status,
        "module_key": (str(data.get("moduleKey") or data.get("module_key") or "").strip() or None),
        "tags_json": _json_dumps(data.get("tags")),
        "visible_role_codes": _json_dumps(data.get("visibleRoleCodes")),
        "visible_department_ids": _json_dumps(data.get("visibleDepartmentIds")),
        "allow_ai": bool(data.get("allowAi", True)),
    }


def _query_articles(cur, user: dict[str, Any], include_archived_for_manager: bool = False) -> list[dict[str, Any]]:
    q = str(request.args.get("q") or "").strip()
    space_id = request.args.get("spaceId")
    category_id = request.args.get("categoryId")
    module_key = str(request.args.get("moduleKey") or "").strip()
    article_type = str(request.args.get("type") or "").strip()
    status = str(request.args.get("status") or "").strip()
    ai_only = str(request.args.get("aiOnly") or "").lower() in {"1", "true", "yes"}
    can_manage = _can_manage(cur, user)

    where = ["s.is_active = TRUE"]
    params: list[Any] = []
    if space_id:
        where.append("a.space_id = %s")
        params.append(int(space_id))
    if category_id:
        where.append("a.category_id = %s")
        params.append(int(category_id))
    if module_key:
        where.append("a.module_key = %s")
        params.append(module_key)
    if article_type:
        where.append("a.article_type = %s")
        params.append(article_type)
    if ai_only:
        where.append("a.allow_ai = TRUE")
    if status:
        where.append("a.status = %s")
        params.append(status)
    elif not can_manage or not include_archived_for_manager:
        where.append("a.status = 'published'")
    if q:
        terms = _search_terms(q)
        for term in terms:
            where.append("(a.title LIKE %s OR a.summary LIKE %s OR a.content LIKE %s OR a.tags_json LIKE %s)")
            like = f"%{term}%"
            params.extend([like, like, like, like])

    _safe_execute(cur, f"""
        SELECT a.*, s.space_name, c.category_name
        FROM knowledge_articles a
        JOIN knowledge_spaces s ON s.id = a.space_id
        LEFT JOIN knowledge_categories c ON c.id = a.category_id
        WHERE {' AND '.join(where)}
        ORDER BY
            CASE WHEN a.status = 'published' THEN 0 WHEN a.status = 'draft' THEN 1 ELSE 2 END,
            COALESCE(a.updated_at, a.created_at) DESC,
            a.id DESC
        LIMIT 500
    """, tuple(params))
    return [row for row in cur.fetchall() if _article_visible(row, user)]


@bp_v2.route("/knowledge/bootstrap", methods=["GET"])
@jwt_required()
def knowledge_bootstrap():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            can_manage = _can_manage(cur, user)
            conn.commit()
            _safe_execute(cur, """
                SELECT id, space_key, space_name, description, sort_order
                FROM knowledge_spaces
                WHERE is_active = TRUE
                ORDER BY sort_order, id
            """)
            spaces = [
                {
                    "id": row["id"],
                    "spaceKey": row["space_key"],
                    "spaceName": row["space_name"],
                    "description": row.get("description") or "",
                    "sortOrder": row["sort_order"],
                }
                for row in cur.fetchall()
            ]
            _safe_execute(cur, """
                SELECT id, space_id, parent_id, category_name, description, sort_order
                FROM knowledge_categories
                WHERE is_active = TRUE
                ORDER BY space_id, sort_order, id
            """)
            categories = [
                {
                    "id": row["id"],
                    "spaceId": row["space_id"],
                    "parentId": row.get("parent_id"),
                    "categoryName": row["category_name"],
                    "description": row.get("description") or "",
                    "sortOrder": row["sort_order"],
                }
                for row in cur.fetchall()
            ]
            return jsonify({"code": 0, "message": "success", "data": {
                "spaces": spaces,
                "categories": categories,
                "canManage": can_manage,
            }})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles", methods=["GET"])
@jwt_required()
def list_knowledge_articles():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            items = [_article_row_to_item(row) for row in _query_articles(cur, user, include_archived_for_manager=True)]
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"items": items, "total": len(items)}})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles/<int:article_id>", methods=["GET"])
@jwt_required()
def get_knowledge_article(article_id: int):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            row = _select_article(cur, article_id)
            if not row or (row.get("status") == "archived" and not _can_manage(cur, user)):
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            if not _article_visible(row, user):
                return _forbidden()
            _safe_execute(cur, "UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id = %s", (article_id,))
            _safe_execute(cur, """
                SELECT * FROM knowledge_attachments
                WHERE article_id = %s
                ORDER BY created_at DESC, id DESC
            """, (article_id,))
            attachments = [_attachment_item(item) for item in cur.fetchall()]
            _safe_execute(cur, """
                SELECT id, article_id, version_no, title, summary, status, module_key, allow_ai, created_by, created_at
                FROM knowledge_article_versions
                WHERE article_id = %s
                ORDER BY version_no DESC
                LIMIT 20
            """, (article_id,))
            versions = [_version_item(item) for item in cur.fetchall()]
            conn.commit()
            article = _article_row_to_item(row, include_content=True)
            article["viewCount"] += 1
            article["attachments"] = attachments
            article["versions"] = versions
            return jsonify({"code": 0, "message": "success", "data": article})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles", methods=["POST"])
@jwt_required()
def create_knowledge_article():
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            if not _can_manage(cur, user):
                return _forbidden()
            try:
                item = _article_payload(data)
            except ValueError as exc:
                return jsonify({"code": 4221, "message": str(exc), "data": None}), 422
            if not item["space_id"]:
                return jsonify({"code": 4221, "message": "space_required", "data": None}), 422
            published_at = datetime.now() if item["status"] == "published" else None
            _safe_execute(cur, """
                INSERT INTO knowledge_articles
                    (space_id, category_id, title, summary, content, content_format, article_type, status,
                     module_key, tags_json, visible_role_codes, visible_department_ids, allow_ai,
                     created_by, updated_by, published_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                item["space_id"], item["category_id"], item["title"], item["summary"], item["content"],
                item["content_format"], item["article_type"], item["status"], item["module_key"],
                item["tags_json"], item["visible_role_codes"], item["visible_department_ids"],
                1 if item["allow_ai"] else 0, user["id"], user["id"], published_at,
            ))
            article_id = cur.lastrowid
            _record_version(cur, article_id, user["id"])
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": article_id}})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles/<int:article_id>", methods=["PUT"])
@jwt_required()
def update_knowledge_article(article_id: int):
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            if not _can_manage(cur, user):
                return _forbidden()
            existing = _select_article(cur, article_id)
            if not existing:
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            try:
                item = _article_payload(data)
            except ValueError as exc:
                return jsonify({"code": 4221, "message": str(exc), "data": None}), 422
            published_at = existing.get("published_at")
            if item["status"] == "published" and not published_at:
                published_at = datetime.now()
            _safe_execute(cur, """
                UPDATE knowledge_articles
                SET space_id = %s,
                    category_id = %s,
                    title = %s,
                    summary = %s,
                    content = %s,
                    content_format = %s,
                    article_type = %s,
                    status = %s,
                    module_key = %s,
                    tags_json = %s,
                    visible_role_codes = %s,
                    visible_department_ids = %s,
                    allow_ai = %s,
                    updated_by = %s,
                    published_at = %s
                WHERE id = %s
            """, (
                item["space_id"], item["category_id"], item["title"], item["summary"], item["content"],
                item["content_format"], item["article_type"], item["status"], item["module_key"],
                item["tags_json"], item["visible_role_codes"], item["visible_department_ids"],
                1 if item["allow_ai"] else 0, user["id"], published_at, article_id,
            ))
            _record_version(cur, article_id, user["id"])
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": article_id}})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles/<int:article_id>", methods=["DELETE"])
@jwt_required()
def archive_knowledge_article(article_id: int):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            if not _can_manage(cur, user):
                return _forbidden()
            if not _select_article(cur, article_id):
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            _safe_execute(cur, """
                UPDATE knowledge_articles
                SET status = 'archived', allow_ai = FALSE, updated_by = %s
                WHERE id = %s
            """, (user["id"], article_id))
            _record_version(cur, article_id, user["id"])
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": article_id, "status": "archived"}})
    finally:
        conn.close()


@bp_v2.route("/knowledge/articles/<int:article_id>/attachments", methods=["POST"])
@jwt_required()
def upload_knowledge_attachment(article_id: int):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            if not _can_manage(cur, user):
                return _forbidden()
            article = _select_article(cur, article_id)
            if not article:
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            file = request.files.get("file")
            if not file or not file.filename:
                return jsonify({"code": 4221, "message": "file_required", "data": None}), 422
            article_dir = KNOWLEDGE_UPLOAD_ROOT / str(article_id)
            article_dir.mkdir(parents=True, exist_ok=True)
            original_name = file.filename
            safe_name = secure_filename(original_name)
            ext = Path(safe_name or original_name).suffix[:20]
            stored_name = f"{uuid.uuid4().hex}{ext}"
            saved_path = article_dir / stored_name
            file.save(saved_path)
            size = saved_path.stat().st_size
            mime_type = file.mimetype or mimetypes.guess_type(original_name)[0]
            _safe_execute(cur, """
                INSERT INTO knowledge_attachments
                    (article_id, original_name, stored_name, file_size, mime_type, uploaded_by)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (article_id, original_name, stored_name, size, mime_type, user["id"]))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {
                "id": cur.lastrowid,
                "articleId": article_id,
                "originalName": original_name,
                "fileSize": size,
                "mimeType": mime_type,
            }})
    finally:
        conn.close()


@bp_v2.route("/knowledge/attachments/<int:attachment_id>", methods=["GET"])
@jwt_required()
def download_knowledge_attachment(attachment_id: int):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            _safe_execute(cur, """
                SELECT f.*, a.status, a.visible_role_codes, a.visible_department_ids
                FROM knowledge_attachments f
                JOIN knowledge_articles a ON a.id = f.article_id
                WHERE f.id = %s
            """, (attachment_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            if row.get("status") == "archived" and not _can_manage(cur, user):
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            if not _article_visible(row, user):
                return _forbidden()
            path = KNOWLEDGE_UPLOAD_ROOT / str(row["article_id"]) / row["stored_name"]
            if not path.exists():
                return jsonify({"code": 4040, "message": "file_missing", "data": None}), 404
            return send_file(path, as_attachment=True, download_name=row["original_name"])
    finally:
        conn.close()


@bp_v2.route("/knowledge/attachments/<int:attachment_id>", methods=["DELETE"])
@jwt_required()
def delete_knowledge_attachment(attachment_id: int):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            if not _can_delete_attachment(user):
                return _forbidden("attachment_delete_admin_only")
            _safe_execute(cur, "SELECT * FROM knowledge_attachments WHERE id = %s", (attachment_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"code": 4040, "message": "not_found", "data": None}), 404
            path = KNOWLEDGE_UPLOAD_ROOT / str(row["article_id"]) / row["stored_name"]
            _safe_execute(cur, "DELETE FROM knowledge_attachments WHERE id = %s", (attachment_id,))
            conn.commit()
            try:
                os.remove(path)
            except OSError:
                pass
            return jsonify({"code": 0, "message": "success", "data": {"id": attachment_id}})
    finally:
        conn.close()


def _snippet(text: str, query: str, max_len: int = 180) -> str:
    compact = re.sub(r"\s+", " ", text or "").strip()
    if len(compact) <= max_len:
        return compact
    terms = _search_terms(query)
    pos = -1
    lower = compact.lower()
    for term in terms:
        pos = lower.find(term.lower())
        if pos >= 0:
            break
    if pos < 0:
        return compact[:max_len].rstrip() + "..."
    start = max(0, pos - 60)
    end = min(len(compact), start + max_len)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(compact) else ""
    return prefix + compact[start:end].rstrip() + suffix


@bp_v2.route("/knowledge/search", methods=["GET"])
@jwt_required()
def search_knowledge():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            user, error = _require_view(cur)
            if error:
                return error
            rows = _query_articles(cur, user)
            q = str(request.args.get("q") or "").strip()
            items = []
            for row in rows:
                item = _article_row_to_item(row)
                item["snippet"] = _snippet(" ".join([row.get("summary") or "", row.get("content") or ""]), q)
                items.append(item)
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"items": items, "total": len(items)}})
    finally:
        conn.close()


def search_knowledge_snippets(user_id: int, question: str, limit: int = 3) -> list[dict[str, Any]]:
    query = str(question or "").strip()
    if not query:
        return []
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_knowledge_schema(cur)
            _safe_execute(cur, """
                SELECT id, username, display_name, role
                FROM system_users
                WHERE id = %s AND is_active = TRUE
            """, (user_id,))
            user = cur.fetchone()
            if not user or (user["role"] != "admin" and not has_permission(cur, user_id, "knowledge:view", user["role"])):
                conn.commit()
                return []
            auth = get_effective_auth(cur, user_id, user["role"])
            user["roles"] = auth.get("roles", [])
            user["departments"] = auth.get("departments", [])
            terms = _search_terms(query)
            where = ["a.status = 'published'", "a.allow_ai = TRUE"]
            params: list[Any] = []
            for term in terms:
                where.append("(a.title LIKE %s OR a.summary LIKE %s OR a.content LIKE %s OR a.tags_json LIKE %s)")
                like = f"%{term}%"
                params.extend([like, like, like, like])
            _safe_execute(cur, f"""
                SELECT a.*, s.space_name, c.category_name
                FROM knowledge_articles a
                JOIN knowledge_spaces s ON s.id = a.space_id AND s.is_active = TRUE
                LEFT JOIN knowledge_categories c ON c.id = a.category_id
                WHERE {' AND '.join(where)}
                ORDER BY COALESCE(a.updated_at, a.created_at) DESC, a.id DESC
                LIMIT 50
            """, tuple(params))
            rows = [row for row in cur.fetchall() if _article_visible(row, user)]
            conn.commit()
            result = []
            for row in rows[:limit]:
                result.append({
                    "id": row["id"],
                    "title": row["title"],
                    "spaceName": row.get("space_name"),
                    "categoryName": row.get("category_name"),
                    "moduleKey": row.get("module_key") or "",
                    "tags": _json_list(row.get("tags_json")),
                    "snippet": _snippet(" ".join([row.get("summary") or "", row.get("content") or ""]), query),
                    "updatedAt": _time_text(row.get("updated_at") or row.get("created_at")),
                })
            return result
    finally:
        conn.close()
