'''
Worker process which handles all graph sessions, in parallel.
'''
import time
import threading
import logging

from django.core.management.base import BaseCommand
from django.utils import timezone

MAX_THREADS = 4

class ExitException(Exception): pass

def get_work():
    pass

def threadwork(simrun, semaphore):
    ''' thread method for simulation and plotting '''
    try:
        pass
        
        # run
        
        # save success state
        
        # log
    
    except Exception as e:
        pass
        
        # save fail state / raise error
        
    finally:
        semaphore.release()

def work(threaded=True, semaphore=None):
    ''' iterates non-started SimRun objects, updates statuses, and calls sim, layout display and plot functions '''
    
    # avoid having two worker threads starting on the same job
    workobj = get_work()
    
    while workobj:
        # exceptions raised during the processing block are written to the simrun object as fail, but do not break the processing loop
        try:
            # work
            
            if threaded:
                semaphore.acquire() # this will block until a slot is released

                t = threading.Thread(target=threadwork, args=(workobj, semaphore))
                t.setDaemon(True)
                t.setName('%s (%s)' % (t.getName().replace('Thread-','T'), workobj.somethinginteresting))
                t.start()
            else:
                threadwork(workobj)
        
        except Exception as e:
            # log error / raise
            
            logging.error('fail: %s (%s)' % (e.__str__(), type(e).__name__))
        
        finally:
            simrun = get_work()
            if not simrun:
                logging.info("idle...")


class Command(BaseCommand):
    help = 'start this in a separate process, it is required for any work to be done'

    def add_arguments(self, parser):
        parser.add_argument('--debug', action='store_true', help="run work() only once")

    def handle(self, *args, **options):
        #logging.basicConfig(level=logging.INFO,
        #            format='%(threadName)-22s: %(message)s',
        #            )

        # error-handling context to start the main loop
        try:
            # debug run
            if options['debug']:
                work(threaded=False)
                exit()
            
            # main threaded execution loop:
            sema = threading.BoundedSemaphore(MAX_THREADS)
            logging.info("created semaphore with %d slots" % MAX_THREADS)
            
            logging.info("looking for simruns...")
            while True:
                work(threaded=True, semaphore=sema)
                time.sleep(1)

        # ctr-c exits
        except KeyboardInterrupt:
            print("")
            logging.info("shutdown requested, exiting...")
            print("")
            print("")

        # handle exit-exception (programmatic shutdown)
        except ExitException as e:
            print("")
            logging.warning("exit exception raised, exiting (%s)" % e.__str__())
            print("")
            print("")


