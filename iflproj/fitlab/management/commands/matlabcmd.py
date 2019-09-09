import time
import json
import sys
import os

from django.core.management.base import BaseCommand

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from fitlab.models import GraphSession, GraphUiRequest, GraphReply

class Command(BaseCommand):
    help = '''Give a command to the live matlab instance and output the results.'''

    def add_arguments(self, parser):
        parser.add_argument('mlcmd', nargs=1, type=str, help='matlab command as a quoted string')
        parser.add_argument('nargout', nargs=1, type=str, help='number of expected output commands (typically, get: 1, set: 0)')

    def handle(self, *args, **options):
        mlcmd = options["mlcmd"][0]
        nargout = 0
        
        if options["nargout"][0]:
            try:
                nargout = int(options["nargout"][0])
            except:
                print("nargout must be a non-negative integer")
                quit()

        uireq = GraphUiRequest(username="admin_request", gs_id=-1, cmd="admin_matlabcmd", syncset=json.dumps({ "mlcmd" : mlcmd, "nargout" : nargout }))
        uireq.save()

        while True:
            for i in range(10):
                lst = GraphReply.objects.filter(reqid=uireq.id)
                if len(lst) == 1:
                    # success, print and exit
                    reply = lst[0]

                    obj = json.loads(reply.reply_json)
                    try:
                        ans = obj["ans"]
                        if type(ans) == list:
                            for l in ans:
                                print(l)
                        else:
                            print(ans)
                    except:
                        try:
                            print("fatalerror: " + obj["fatalerror"])
                        except:
                            print("command failed without any given reason")

                    return
                time.sleep(0.5)
            print("waiting for worker reply...")

