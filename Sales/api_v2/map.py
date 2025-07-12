from flask import jsonify, request
from flask_jwt_extended import jwt_required, get_jwt
from api_v2 import bp_v2


STATIONS = [
    {'name': 'STN-01', 'short': 'S-02', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 1},
    {'name': 'STN-03', 'short': 'S-04', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 2},
    {'name': 'STN-05', 'short': 'S-06', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 3},
    {'name': 'STN-07', 'short': 'S-08', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 4},
    {'name': 'STN-09', 'short': 'S-10', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 5},
    {'name': 'STN-11', 'short': 'S-12', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 6},
    {'name': 'STN-13', 'short': 'S-14', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 7},
    {'name': 'STN-55', 'short': 'S-56', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 28},
    {'name': 'STN-59', 'short': 'S-60', 'region': 'REG-01', 'lng': 0, 'lat': 0, 'shopKey': 30},
    {'name': 'STN-15', 'short': 'S-16', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 8},
    {'name': 'STN-17', 'short': 'S-18', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 9},
    {'name': 'STN-19', 'short': 'S-20', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 10},
    {'name': 'STN-21', 'short': 'S-22', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 11},
    {'name': 'STN-23', 'short': 'S-24', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 12},
    {'name': 'STN-25', 'short': 'S-26', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 13},
    {'name': 'STN-27', 'short': 'S-28', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 14},
    {'name': 'STN-29', 'short': 'S-30', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 15},
    {'name': 'STN-49', 'short': 'S-50', 'region': 'REG-02', 'lng': 0, 'lat': 0, 'shopKey': 25},
    {'name': 'STN-31', 'short': 'S-32', 'region': 'REG-03', 'lng': 0, 'lat': 0, 'shopKey': 16},
    {'name': 'STN-33', 'short': 'S-34', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 17},
    {'name': 'STN-35', 'short': 'S-36', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 18},
    {'name': 'STN-57', 'short': 'S-58', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 29},
    {'name': 'STN-53', 'short': 'S-54', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 27},
    {'name': 'STN-37', 'short': 'S-38', 'region': 'REG-05', 'lng': 0, 'lat': 0, 'shopKey': 19},
    {'name': 'STN-39', 'short': 'S-40', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 20},
    {'name': 'STN-41', 'short': 'S-42', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 21},
    {'name': 'STN-43', 'short': 'S-44', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 22},
    {'name': 'STN-45', 'short': 'S-46', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 23},
    {'name': 'STN-47', 'short': 'S-48', 'region': 'REG-04', 'lng': 0, 'lat': 0, 'shopKey': 24},
    {'name': 'STN-51', 'short': 'S-52', 'region': 'REG-06', 'lng': 0, 'lat': 0, 'shopKey': 26},
]

DEPOTS = [
    {'name': 'DemoDepotNorth', 'short': 'Север DemoDepot', 'region': 'REG-06', 'lng': 0, 'lat': 0},
    {'name': 'DemoDepotSouth', 'short': 'Юж DemoDepot', 'region': 'REG-07', 'lng': 0, 'lat': 0},
]

# 角色 → 可见图层
ROLE_LAYERS = {
    'admin': ['stations', 'depots', 'customers'],
    'operator': ['stations', 'depots'],
    'auditor': ['depots'],
    'viewer': ['stations', 'depots'],
}


@bp_v2.route('/map/stations', methods=['GET'])
@jwt_required(optional=True)
def map_stations():
    claims = get_jwt() or {}
    role = claims.get('role', 'viewer')
    view = request.args.get('view', '')

    allowed = ROLE_LAYERS.get(role, ['stations', 'depots'])
    if view and role == 'admin':
        allowed = view.split(',')

    result = {}
    if 'stations' in allowed:
        result['stations'] = STATIONS
    else:
        result['stations'] = []
    if 'depots' in allowed:
        result['depots'] = DEPOTS
    else:
        result['depots'] = []
    result['customers'] = []
    result['role'] = role
    result['allowedLayers'] = allowed

    return jsonify({'code': 0, 'data': result})
