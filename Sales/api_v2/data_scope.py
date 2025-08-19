from __future__ import annotations

from typing import Any

import pymysql

from .permission_service import get_effective_auth


def custom_resource_filter(
    cur,
    user_id: int,
    module_key: str,
    columns: dict[str, dict[str, list[str]]],
) -> tuple[str, list[Any]]:
    cur.execute("SELECT role FROM system_users WHERE id = %s", (user_id,))
    user = cur.fetchone()
    if not user:
        return " AND 1=0", []
    legacy_role = user["role"] if isinstance(user, dict) else user[0]
    if legacy_role == "admin":
        return "", []

    auth = get_effective_auth(cur, user_id, legacy_role)
    if auth["dataScopes"].get(module_key) != "custom":
        return "", []

    role_ids = [role["id"] for role in auth["roles"]]
    dept_ids = [dept["id"] for dept in auth["departments"]]
    owner_conditions = ["(owner_type = 'user' AND owner_id = %s)"]
    owner_params: list[Any] = [user_id]
    if role_ids:
        owner_conditions.append(f"(owner_type = 'role' AND owner_id IN ({','.join(['%s'] * len(role_ids))}))")
        owner_params.extend(role_ids)
    if dept_ids:
        owner_conditions.append(f"(owner_type = 'department' AND owner_id IN ({','.join(['%s'] * len(dept_ids))}))")
        owner_params.extend(dept_ids)

    cur.execute(f"""
        SELECT resource_type, resource_id, resource_label
        FROM system_data_scope_resources
        WHERE module_key = %s
          AND ({' OR '.join(owner_conditions)})
    """, [module_key] + owner_params)
    resources = cur.fetchall()
    if not resources:
        return " AND 1=0", []

    ids_by_type: dict[str, list[str]] = {}
    labels_by_type: dict[str, list[str]] = {}
    for row in resources:
        resource_type = row["resource_type"] if isinstance(row, dict) else row[0]
        resource_id = str(row["resource_id"] if isinstance(row, dict) else row[1])
        resource_label = row["resource_label"] if isinstance(row, dict) else row[2]
        ids_by_type.setdefault(resource_type, []).append(resource_id)
        if resource_label:
            labels_by_type.setdefault(resource_type, []).append(str(resource_label))

    labels_by_type.update(_load_missing_resource_labels(cur, ids_by_type, labels_by_type))

    clauses: list[str] = []
    params: list[Any] = []
    for resource_type, mapping in columns.items():
        ids = ids_by_type.get(resource_type, [])
        labels = labels_by_type.get(resource_type, [])
        for column in mapping.get("ids", []):
            if ids:
                clauses.append(f"{column} IN ({','.join(['%s'] * len(ids))})")
                params.extend(ids)
        for column in mapping.get("labels", []):
            if labels:
                clauses.append(f"{column} IN ({','.join(['%s'] * len(labels))})")
                params.extend(labels)

    if not clauses:
        return " AND 1=0", []
    return f" AND ({' OR '.join(clauses)})", params


def custom_resource_values(cur, user_id: int, module_key: str, resource_type: str) -> dict[str, list[str]] | None:
    cur.execute("SELECT role FROM system_users WHERE id = %s", (user_id,))
    user = cur.fetchone()
    if not user:
        return {"ids": [], "labels": []}
    legacy_role = user["role"] if isinstance(user, dict) else user[0]
    if legacy_role == "admin":
        return None

    auth = get_effective_auth(cur, user_id, legacy_role)
    if auth["dataScopes"].get(module_key) != "custom":
        return None

    role_ids = [role["id"] for role in auth["roles"]]
    dept_ids = [dept["id"] for dept in auth["departments"]]
    owner_conditions = ["(owner_type = 'user' AND owner_id = %s)"]
    owner_params: list[Any] = [user_id]
    if role_ids:
        owner_conditions.append(f"(owner_type = 'role' AND owner_id IN ({','.join(['%s'] * len(role_ids))}))")
        owner_params.extend(role_ids)
    if dept_ids:
        owner_conditions.append(f"(owner_type = 'department' AND owner_id IN ({','.join(['%s'] * len(dept_ids))}))")
        owner_params.extend(dept_ids)

    cur.execute(f"""
        SELECT resource_id, resource_label
        FROM system_data_scope_resources
        WHERE module_key = %s
          AND resource_type = %s
          AND ({' OR '.join(owner_conditions)})
    """, [module_key, resource_type] + owner_params)
    rows = cur.fetchall()
    ids = [str(row["resource_id"] if isinstance(row, dict) else row[0]) for row in rows]
    labels = [str(row["resource_label"] if isinstance(row, dict) else row[1]) for row in rows if (row["resource_label"] if isinstance(row, dict) else row[1])]
    if ids and not labels:
        labels = _load_missing_resource_labels(cur, {resource_type: ids}, {}).get(resource_type, [])
    return {"ids": ids, "labels": labels}


def owner_scope_filter(cur, user_id: int, module_key: str, owner_column: str) -> tuple[str, list[Any]]:
    cur.execute("SELECT role FROM system_users WHERE id = %s", (user_id,))
    user = cur.fetchone()
    if not user:
        return " AND 1=0", []
    legacy_role = user["role"] if isinstance(user, dict) else user[0]
    if legacy_role == "admin":
        return "", []

    auth = get_effective_auth(cur, user_id, legacy_role)
    scope = auth["dataScopes"].get(module_key)
    if scope in (None, "all", "custom"):
        return "", []
    if scope == "self":
        return f" AND {owner_column} = %s", [user_id]

    dept_ids = [int(dept["id"]) for dept in auth["departments"]]
    if scope == "dept_tree":
        dept_ids = _expand_department_tree(cur, dept_ids)
    if not dept_ids:
        return " AND 1=0", []

    placeholders = ",".join(["%s"] * len(dept_ids))
    cur.execute(
        f"SELECT DISTINCT user_id FROM system_user_departments WHERE dept_id IN ({placeholders})",
        dept_ids,
    )
    owner_ids = [row["user_id"] if isinstance(row, dict) else row[0] for row in cur.fetchall()]
    if not owner_ids:
        return " AND 1=0", []
    return f" AND {owner_column} IN ({','.join(['%s'] * len(owner_ids))})", owner_ids


def _expand_department_tree(cur, dept_ids: list[int]) -> list[int]:
    if not dept_ids:
        return []
    cur.execute("SELECT id, parent_id FROM system_departments WHERE is_active = TRUE")
    children_by_parent: dict[int | None, list[int]] = {}
    for row in cur.fetchall():
        dept_id = int(row["id"] if isinstance(row, dict) else row[0])
        parent_id = row["parent_id"] if isinstance(row, dict) else row[1]
        parent_key = int(parent_id) if parent_id is not None else None
        children_by_parent.setdefault(parent_key, []).append(dept_id)

    expanded = set(dept_ids)
    stack = list(dept_ids)
    while stack:
        current = stack.pop()
        for child_id in children_by_parent.get(current, []):
            if child_id not in expanded:
                expanded.add(child_id)
                stack.append(child_id)
    return sorted(expanded)


def _load_missing_resource_labels(
    cur,
    ids_by_type: dict[str, list[str]],
    labels_by_type: dict[str, list[str]],
) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    customer_ids = ids_by_type.get("customer", [])
    if customer_ids and not labels_by_type.get("customer"):
        try:
            cur.execute(
                f"SELECT standard_name FROM customers WHERE id IN ({','.join(['%s'] * len(customer_ids))})",
                customer_ids,
            )
            result["customer"] = [
                row["standard_name"] if isinstance(row, dict) else row[0]
                for row in cur.fetchall()
            ]
        except pymysql.err.ProgrammingError:
            result["customer"] = []
    return result
