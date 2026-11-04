import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("WEB_THREADS", "4"))
timeout = 120
preload_app = True
accesslog = "-"
errorlog = "-"
loglevel = "info"
