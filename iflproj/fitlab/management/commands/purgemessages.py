from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphUiRequest, GraphReply

class Command(BaseCommand):
    help = 'Removes all pending server/worker messages in both directions.'

    def add_arguments(self, parser):
        pass
        # adduser(dn, admin_password, cn, sn, uid, email, pw)
        #parser.add_argument('python_module', nargs=1, type=str, help='python module to apply node type extraction to')

    def handle(self, *args, **options):
        uireqs = GraphUiRequest.objects.all()
        replies = GraphReply.objects.all()
        print("purging uirequests: %d objects" % len(uireqs))
        print("purging graphreplies: %d objects" % len(replies))
        for uireq in uireqs:
            uireq.delete()
        for reply in replies:
            reply.delete()

