from datetime import datetime
import json
from os.path import isfile
from getpass import getpass

from django.contrib.auth import authenticate
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphSession

class Command(BaseCommand):
    help = '''Import examples from a json format named IFL and put them into the db.
    Requires username and password, to which the resulting example sessions will be attributed.
    NOTE: Session meta data such as org_username, created, and IFL metadata such as created, format
    and vesion, are not carried over.'''

    def add_arguments(self, parser):
        parser.add_argument('example_file', nargs=1, type=str, help='IFL file containing example data')
        parser.add_argument('--dryrun', action='store_true', help='keep the database uncanged')


    def handle(self, *args, **options):
        try:
            dryrun = options["dryrun"]

            # load and display IFL format
            exfilename = options["example_file"][0]
            if not isfile(exfilename):
                print("invalid file")
            
            text = open(exfilename, 'r').read()
            obj = json.loads(text)
            entries = obj.get("entries", [])
            
            print("loading example data...")
            print("format: %s" % obj.get("format", "undefined"))
            print("version: %s" % obj.get("version", "undefined"))
            print("created: %s" % obj.get("created", "undefined"))
            print("entries: %d" % len(entries))
    
            # authenticate super user to assign examples to
            print()
            print("please enter example owner credentials")
            username=input("Username: ")
            password=getpass()
            print()
            user = authenticate(username=username, password=password)
            if user:
                if not user.is_superuser:
                    print("super-user required")
                    quit()
            else:
                print("invalud user credentials")
                quit()
            
            # load entries and create objects (dry)
            tocreate = []
            for entry in obj["entries"]:
                e = GraphSession()
                e.username = username
                e.example = True
                e.title = entry.get("title", "")
                e.description = entry.get("description", "")
                e.excomment = entry.get("excomment", "")
                e.listidx = entry.get("listidx", 0)
                # TODO: maybe a try-catch - graphdef errors are critical
                gd = json.dumps(entry.get("graphdef", {}))
                e.graphdef = gd
                tocreate.append(e)

            # save objects to db (wet)
            existing = GraphSession.objects.filter(example=True).order_by('listidx')
            # reset all listidx values to pretty
            for i in range(len(existing)):
                gs = existing[i]
                gs.listidx = i;
                if not dryrun:
                    gs.save()

            # reset new example listidx values on top of existing, sort then relabel
            startidx = len(existing)
            tocreate.sort(key=lambda e: e.listidx)
            for i in range(len(tocreate)):
                e = tocreate[i]
                e.listidx = startidx + i

            for e in tocreate:
                if not dryrun:
                    e.save()

            print("objects created: ", len(tocreate))


        except KeyboardInterrupt:
            print()
            quit()
