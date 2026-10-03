"""Filesystem locations shared by the app and its routers.

The project is split into backend/ (this folder) and frontend/
(Jinja2 templates + static assets).  The backend serves the frontend, so it
needs to know where it lives.  Override with FRONTEND_DIR if you deploy the
two folders somewhere else.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR") or BACKEND_DIR.parent / "frontend").resolve()
TEMPLATES_DIR = FRONTEND_DIR / "templates"
STATIC_DIR = FRONTEND_DIR / "static"
