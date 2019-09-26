from django.core.management.base import BaseCommand
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphSession

class Command(BaseCommand):
    help = '''Remove the "Example" tag from all example sessions. This command does not delete anything.'''

    def add_arguments(self, parser):
        pass
        #parser.add_argument('username', nargs=1, type=str, help='username filter for resetting sessions')

    def handle(self, *args, **options):
        try:
            examples = GraphSession.objects.filter(example=True)

            print("examples found: %d" % len(examples)) 
            for ex in examples:
                ex.example = False
                ex.save()
            print("all examples were demoted to regular sessions")

        except KeyboardInterrupt:
            print()
            quit()
