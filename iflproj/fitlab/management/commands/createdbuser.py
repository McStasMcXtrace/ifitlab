from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

class Command(BaseCommand):
    help = 'creates the debug supersuser with no terminal interaction.'

    def add_arguments(self, parser):
        pass
        # adduser(dn, admin_password, cn, sn, uid, email, pw)
        #parser.add_argument('python_module', nargs=1, type=str, help='python module to apply node type extraction to')

    def handle(self, *args, **options):
        print("creating superuser: 'admin' with pw: 'admin123")
        User.objects.create_user(username='admin', email='', password='admin123')

