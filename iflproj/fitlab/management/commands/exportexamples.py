from datetime import datetime
import json

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphSession

class Command(BaseCommand):
    help = '''Export all examples into a json format named IFL. The resulting file can be imported into
    another IFL instance.'''

    def add_arguments(self, parser):
        pass
        #parser.add_argument('username', nargs=1, type=str, help='username filter for resetting sessions')

    def handle(self, *args, **options):
        try:


            # the IFL file format!
            entries = []
            obj = {
                "format" : "IFL",
                "version" : "0.1",
                "created" : datetime.now().strftime("%Y%m%d_%H%M"),
                "entries" : entries,
            }
            examples = GraphSession.objects.filter(example=True)

            print("examples found: %d" % len(examples)) 
            for ex in examples:

                entry = {
                    "created" : str(ex.created),
                    "org_username" : ex.username,
                    "title" : ex.title,
                    "description" : ex.description,
                    "excomment" : ex.excomment,
                    "listidx" : ex.listidx,
                    "graphdef" : json.loads(ex.graphdef),
                }
                entries.append(entry)

            text = json.dumps(obj)
            dtstr = datetime.now().strftime("%Y%m%d")
            open("examples_%s.ifl" % dtstr, "w").write(text)


        except KeyboardInterrupt:
            print()
            quit()
