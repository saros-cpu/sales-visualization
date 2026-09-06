# -*- coding: utf-8 -*-
"""Web 端 JWT 迁移 HttpOnly Cookie（整改方案任务5，SALES_AUTH_COOKIE_MODE 开关）。

模式：
  off    —— 默认，仅 header（Desktop 5.6.0 及现有客户端完全不变）
  dual   —— header + Cookie 双通道：仍下发 token 正文，同时种 HttpOnly Cookie
  cookie —— 同 dual（服务端行为一致；区别在前端是否继续写 localStorage）

Desktop 5.6.0 永远走 Authorization header，不受本开关影响。
CSRF：本轮使用 SameSite=Lax 且未启用双重提交 Cookie；正式收紧前需按整改方案
为 Web 端增加 CSRF 头（见 docs/项目审计与整改方案.md 任务5 依赖任务4）。
"""
import os

from flask_jwt_extended import set_access_cookies, set_refresh_cookies, unset_jwt_cookies

_COOKIE_MODES = ("dual", "cookie")


def cookie_mode() -> str:
    return os.getenv("SALES_AUTH_COOKIE_MODE", "off").strip().lower()


def cookie_mode_enabled() -> bool:
    return cookie_mode() in _COOKIE_MODES


def apply_auth_config(app) -> None:
    """根据环境变量在启动时（或测试中随时）调整 flask-jwt-extended 配置。"""
    if cookie_mode_enabled():
        app.config["JWT_TOKEN_LOCATION"] = ["headers", "cookies"]
        app.config["JWT_COOKIE_SECURE"] = True
        app.config["JWT_COOKIE_HTTPONLY"] = True
        app.config["JWT_COOKIE_SAMESITE"] = "Lax"
        app.config["JWT_COOKIE_CSRF_PROTECT"] = False
        app.config["JWT_COOKIE_DOMAIN"] = None
    else:
        app.config["JWT_TOKEN_LOCATION"] = ["headers"]


def attach_auth_cookies(response, access_token, refresh_token=None):
    """dual/cookie 模式下把新 token 种到 HttpOnly Cookie；off 模式原样返回。"""
    if not cookie_mode_enabled():
        return response
    set_access_cookies(response, access_token)
    if refresh_token:
        set_refresh_cookies(response, refresh_token)
    return response


def clear_auth_cookies(response):
    """dual/cookie 模式下清除 JWT Cookie（退出登录用）。"""
    if not cookie_mode_enabled():
        return response
    unset_jwt_cookies(response)
    return response
