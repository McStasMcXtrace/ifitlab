'''
Contains log handlers and a shared error log.
'''
import logging
logging.basicConfig(level=logging.INFO, format='%(threadName)-3s: %(message)s' )


_englog = None
def log_engine(msg, error=False):
    global _englog
    if not _englog:
        _englog = logging.getLogger('engine')
        hdlr = logging.FileHandler('logs/engine.log')
        hdlr.setFormatter(logging.Formatter('%(threadName)-3s %(asctime)s : %(message)s', '%Y%m%d_%H%M%S'))
        _englog.addHandler(hdlr)
        _englog.info("")
        _englog.info("")
        _englog.info("%%  starting engine log session  %%")
    _englog.info(msg)
    if error:
        _log_error(msg)

_wrklog = None
def log_workers(msg, error=False):
    global _wrklog
    if not _wrklog:
        _wrklog = logging.getLogger('workers')
        hdlr = logging.FileHandler('logs/workers.log')
        hdlr.level = logging.INFO
        hdlr.setFormatter(logging.Formatter('%(threadName)-3s %(asctime)s : %(message)s', '%Y%m%d_%H%M%S'))
        _wrklog.addHandler(hdlr)
    _wrklog.info(msg)
    if error:
        _log_error(msg)

_errlog = None
def _log_error(msg):
    global _errlog
    if not _errlog:
        _errlog = logging.getLogger('errors')
        hdlr = logging.FileHandler('logs/errors.log')
        hdlr.level = logging.INFO
        hdlr.setFormatter(logging.Formatter('%(threadName)-3s %(asctime)s : %(message)s', '%Y%m%d_%H%M%S'))
        _errlog.addHandler(hdlr)
    _errlog.info(msg)