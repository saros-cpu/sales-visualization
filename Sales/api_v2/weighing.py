from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from services.weighing_service import (
    batch_review_weighing,
    get_weighing_filter_options,
    get_weighing_list,
    verify_weighing,
)
import pymysql
from db import get_connection
from datetime import date, datetime, timedelta


def _parse_date_arg(name: str, default: date) -> date:
    value = request.args.get(name)
    if not value:
        return default
    return datetime.strptime(value, '%Y-%m-%d').date()


def _split_csv_arg(*names: str) -> list[str] | None:
    for name in names:
        value = request.args.get(name)
        if value:
            return [part.strip() for part in value.split(',') if part.strip()]
    return None


@bp_v2.route('/weighing/list', methods=['GET'])
@jwt_required()
@permission_required('weighing:view')
def weighing_list():
    date_from = _parse_date_arg('date_from', date.today() - timedelta(days=7))
    date_to = _parse_date_arg('date_to', date.today())
    vehicle_no = request.args.get('vehicle_no')
    status = request.args.get('status')
    classification = request.args.get('classification')
    product_name = request.args.get('product_name')
    entity_name = request.args.get('entity_name')
    source = request.args.get('source')
    sender_names = _split_csv_arg('sender_names', 'col_sender')
    receiver_names = _split_csv_arg('receiver_names', 'col_receiver')
    product_names = _split_csv_arg('product_names', 'col_product')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    result = get_weighing_list(
        date_from=date_from,
        date_to=date_to,
        vehicle_no=vehicle_no,
        status=status,
        classification=classification,
        product_name=product_name,
        entity_name=entity_name,
        source=source,
        sender_names=sender_names,
        receiver_names=receiver_names,
        product_names=product_names,
        page=page,
        page_size=page_size,
    )
    return jsonify({'code': 0, 'message': 'success', 'data': result})


@bp_v2.route('/weighing/filter-options', methods=['GET'])
@jwt_required()
@permission_required('weighing:view')
def weighing_filter_options():
    date_from = _parse_date_arg('date_from', date(2000, 1, 1))
    date_to = _parse_date_arg('date_to', date.today())
    result = get_weighing_filter_options(date_from=date_from, date_to=date_to)
    return jsonify({'code': 0, 'message': 'success', 'data': result})


@bp_v2.route('/weighing/verify', methods=['POST'])
@jwt_required()
@permission_required('weighing:verify')
def weighing_verify():
    data = request.get_json() or {}
    weighing_source = data.get('source')
    weighing_id = data.get('id')
    field_name = data.get('fieldName')
    old_value = data.get('oldValue', '')
    new_value = data.get('newValue', '')
    remark = data.get('remark', '')

    if not all([weighing_source, weighing_id, field_name, new_value is not None]):
        return jsonify({'code': 4221, 'message': '参数不完整', 'data': None}), 422

    try:
        verify_weighing(
            weighing_source=weighing_source,
            weighing_id=int(weighing_id),
            field_name=field_name,
            old_value=str(old_value),
            new_value=str(new_value),
            operator_id=int(get_jwt_identity()),
            remark=remark,
        )
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    except Exception as e:
        return jsonify({'code': 5001, 'message': str(e), 'data': None}), 500


@bp_v2.route('/weighing/batch-verify', methods=['POST'])
@jwt_required()
@permission_required('weighing:verify')
def weighing_batch_verify():
    data = request.get_json() or {}
    records = data.get('records', [])

    if not records:
        return jsonify({'code': 4221, 'message': '没有待修正的记录', 'data': None}), 422

    success_count = 0
    errors = []
    operator_id = int(get_jwt_identity())

    for rec in records:
        try:
            verify_weighing(
                weighing_source=rec['source'],
                weighing_id=int(rec['id']),
                field_name=rec['fieldName'],
                old_value=str(rec.get('oldValue', '')),
                new_value=str(rec['newValue']),
                operator_id=operator_id,
                remark=rec.get('remark', ''),
            )
            success_count += 1
        except Exception as e:
            errors.append({'id': rec['id'], 'error': str(e)})

    return jsonify({
        'code': 0, 'message': 'success',
        'data': {
            'successCount': success_count,
            'errorCount': len(errors),
            'errors': errors,
        }
    })


@bp_v2.route('/weighing/batch-review', methods=['POST'])
@jwt_required()
@permission_required('weighing:verify')
def weighing_batch_review():
    data = request.get_json() or {}
    records = data.get('records') or []
    action = data.get('action')
    classification = data.get('classification')
    remark = data.get('remark') or ''

    if not records:
        return jsonify({'code': 4221, 'message': 'No selected records', 'data': None}), 422

    try:
        result = batch_review_weighing(
            records=records,
            action=action,
            classification=classification,
            operator_id=int(get_jwt_identity()),
            remark=remark,
        )
        return jsonify({'code': 0, 'message': 'success', 'data': result})
    except ValueError as exc:
        return jsonify({'code': 4221, 'message': str(exc), 'data': None}), 422
    except Exception as exc:
        return jsonify({'code': 5001, 'message': str(exc), 'data': None}), 500


@bp_v2.route('/weighing/history', methods=['GET'])
@jwt_required()
@permission_required('weighing:view')
def weighing_history():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT w.id, w.weighing_source, w.weighing_id, w.field_name,
                       w.old_value, w.new_value, w.remark, w.created_at,
                       u.display_name AS operator_name
                FROM weighing_audit_log w
                LEFT JOIN system_users u ON w.operator_id = u.id
                ORDER BY w.created_at DESC
                LIMIT 200
            ''')
            items = []
            for row in cur.fetchall():
                items.append({
                    'id': row['id'],
                    'source': row['weighing_source'],
                    'weighingId': row['weighing_id'],
                    'fieldName': row['field_name'],
                    'oldValue': row['old_value'],
                    'newValue': row['new_value'],
                    'remark': row['remark'],
                    'createdAt': str(row['created_at']),
                    'operatorName': row['operator_name'],
                })
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
