import sys
import os
import time
import json

from django.core.management.base import BaseCommand

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from fitlab.models import GraphSession, GraphUiRequest, GraphReply

class Command(BaseCommand):
    help = '''Shutdown all/user/gsid sessions nicely, saving all info.

    This command preserves volatile data, which the command resetsessions does not, but
    does not reset pickles.
    '''

    def add_arguments(self, parser):
        pass
        #parser.add_argument('username', nargs=1, type=str, help='username filter for resetting sessions')

    def handle(self, *args, **options):
        print("save and shut down active sessions:")

        uireq = GraphUiRequest(username="admin_request", gs_id=-1, cmd="admin_shutdownall", syncset=None)
        uireq.save()

        while True:
            for i in range(10):
                lst = GraphReply.objects.filter(reqid=uireq.id)
                if len(lst) == 1:
                    # success, print and exit
                    reply = lst[0]
                    obj = json.loads(reply.reply_json)
                    try:
                        print(obj["msg"])
                    except:
                        try:
                            print("fatalerror: " + obj["fatalerror"])
                        except:
                            print("command failed without any given reason")
                    return
                time.sleep(0.5)
            print("waiting for worker reply...")
