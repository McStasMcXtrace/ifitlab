import time
import json

from django.core.management.base import BaseCommand
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphSession, GraphUiRequest, GraphReply

class Command(BaseCommand):
    help = '''Reset all sessions (pickles and matfiles), prompting a global re-construction 
    from graphdef data. This will prevent bugs from being softly re-introduced via previously
    saved pickles, and causes current engine/middleware code to be used for all session objects.
    NOTE: requires running worker process.'''

    def add_arguments(self, parser):
        pass
        #parser.add_argument('username', nargs=1, type=str, help='username filter for resetting sessions')

    def handle(self, *args, **options):
        sessions = GraphSession.objects.all()
        print("resetting sessions: %d objects" % len(sessions))

        uireq = GraphUiRequest(username="admin_request", gs_id=-1, cmd="admin_resetall", syncset=None)
        uireq.save()

        while True:
            print("waiting for worker reply...")
            for i in range(10):
                lst = GraphReply.objects.filter(reqid=uireq.id)
                if len(lst) == 1:
                    # success, print and exit
                    reply = lst[0]
                    print(json.loads(reply.reply_json)["msg"])
                    return
                time.sleep(0.5)

