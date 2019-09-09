import time
import json
import sys
import os

from django.core.management.base import BaseCommand

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from fitlab.models import GraphSession, GraphUiRequest, GraphReply

class Command(BaseCommand):
    help = '''List variables in middleware, MATLAB or diff.'''

    def add_arguments(self, parser):
        pass
        #parser.add_argument('arg', nargs=1, type=str, help='some help docstring')

    def handle(self, *args, **options):
        print("loaded matlab vars:")

        uireq = GraphUiRequest(username="admin_request", gs_id=-1, cmd="admin_showvars", syncset=None)
        uireq.save()

        while True:
            for i in range(10):
                lst = GraphReply.objects.filter(reqid=uireq.id)
                if len(lst) == 1:
                    # success, print and exit
                    reply = lst[0]
                    lst = json.loads(reply.reply_json)["vars"]
                    for l in lst:
                        print(l)
                    return
                time.sleep(0.5)
            print("waiting for worker reply...")
