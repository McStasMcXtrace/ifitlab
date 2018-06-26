'''
Generates "flatext" node type confs from a python module.
'''
from django.core.management.base import BaseCommand

import importlib
import json

import engintf

class Command(BaseCommand):
    help = ''

    def add_arguments(self, parser):
        # adduser(dn, admin_password, cn, sn, uid, email, pw)
        parser.add_argument('python_module', nargs=1, type=str, help='python module to apply node type extraction to')
        parser.add_argument('python_package', nargs=1, type=str, help='package containing python_module')

    def handle(self, *args, **options):
        print('running gen_types on module "%s"' % options["python_module"][0])

        mdl = importlib.import_module(options["python_module"][0], options["python_package"][0])
        namecategories = getattr(mdl, "namecategories")

        clss, fcts = engintf.get_nodetype_candidates(mdl)
        tree, addrss = engintf.ctypeconf_tree_ifit(clss, fcts, namecategories)

        engintf.save_nodetypes_js('fitlab/static/fitlab', tree, addrss)
        engintf.save_nodeconfs_addresses_json(tree, addrss)
        engintf.save_modulename_json(options["python_module"][0], options["python_package"][0])
