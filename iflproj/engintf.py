'''
Nodespeak extension using a single root node and one layer of sub-nodes.
'''
__author__ = "Jakob Garde"

import inspect
import json
import re
import os
from collections import OrderedDict

from nodespeak import RootNode, FuncNode, ObjNode, MethodNode, MethodAsFunctionNode, add_subnode, remove_subnode
from nodespeak import add_connection, remove_connection, execute_node, NodeNotExecutableException, ObjLitteralNode

class TreeJsonAddr:
    '''
    A local tree with "string addressing" where dots syntactically are delimiters between paths in
    the branching hierarchy.

    The tree is a "put-retrieve" tree with a "leaf" and a "branch" for every node, except root,
    which is considered a branch. Putting items into the root layer is indicated by the address "''",
    Within branches, nodes (an instance of the mentioned node, a {leaf, branch} dict), are keyed
    with get_key(item). The user must provide this, thus attaining full content flexibility.
    These keys in turn make up the address words.

    The tree will create any non-existing paths that are put, but not retrieved, in which case
    None is returned.
    '''
    def __init__(self, existing={}):
        self.root = existing

    def retrieve(self, address):
        root = self.root
        item = self._descend_recurse(root, address)['leaf']
        return item

    def put(self, address, item, getkey):
        root = self.root
        branch = root
        if address != '' and not address[0] == '.':
            branch = self._descend_recurse(root, address)['branch']
        key = getkey(item)
        self._get_or_create(branch, key)['leaf'] = item

    def _get_or_create(self, dct, key):
        if not dct.get(key, None):
            dct[key] = { 'leaf' : None, 'branch': {} }
        return dct[key]

    def _descend_recurse(self, branch, address):
        m = re.match('([^\.]+)\.(.*)', address)
        if address == '':
            raise Exception
        if m:
            key = m.group(1)
            address = m.group(2)
            branch = self._get_or_create(branch, key)['branch']
            return self._descend_recurse(branch, address)
        else:
            key = address
            return self._get_or_create(branch, key)


class ObjReprJson:
    '''
    to serialize objects to the fron-end, requires a js readable like json
    '''
    def _get_full_repr_dict(self):
        ''' people can overload get_repr without having to call super, but just get the standard dict format from this method '''
        ans = OrderedDict()
        # TODO: consider adding more meta stuff here
        #ans['__class__'] = str(self.__class__)
        ans['info'] = '__class__: %s' % str(self.__class__)
        ans['userdata'] = ''
        ans['plotdata'] = ''
        return ans
    def get_repr(self):
        dct = self._get_full_repr_dict()
        return dct
    def set_user_data(self, json_obj):
        pass


'''
Id- and type based graph manipulation interface.

WARNING: "id" here is what nodespeak means by "name"
'''
class FlatGraph:
    def __init__(self, tpe_tree, pmodule):
        self.root = RootNode("root")
        self.tpe_tree = tpe_tree
        self.pmodule = pmodule
        self.node_cmds_cache = {}
        self.dslinks_cache = {} # ds = downstream
    def _create_node(self, id, tpe_addr):
        conf = self.tpe_tree.retrieve(tpe_addr)
        n = None
        node_tpe = basetypes[conf['basetype']]
        if node_tpe == ObjNode:
            n = ObjNode(id, None)
        elif node_tpe == ObjLitteralNode:
            n = ObjLitteralNode(id, None)
        elif node_tpe == FuncNode:
            func = getattr(self.pmodule, conf['type'])
            n = FuncNode(id, func)
        elif node_tpe == MethodAsFunctionNode:
            n = MethodAsFunctionNode(id, conf['type'])
        elif node_tpe == MethodNode:
            raise Exception("MethodNode not supported")
        return n

    def node_add(self, x, y, id, name, label, tpe):
        n = self._create_node(id, tpe)
        print('created node of type: "%s", content: "%s"' % (str(type(n)), str(n.get_object())))
        add_subnode(self.root, n)
        # caching
        self.node_cmds_cache[id] = (x, y, id, name, label, tpe)

    def node_rm(self, id):
        n = self.root.subnodes.get(id, None)
        if not n:
            return
        if n.num_parents() != 0 or n.num_children() != 0:
            raise Exception("node_rm: can not remove node with existing links")
        remove_subnode(self.root, n)
        # caching
        del self.node_cmds_cache[id]

    def link_add(self, id1, idx1, id2, idx2, order):
        n1 = self.root.subnodes[id1]
        n2 = self.root.subnodes[id2]
        add_connection(n1, idx1, n2, idx2, order)
        # caching
        if not self.dslinks_cache.get(id1, None):
            self.dslinks_cache[id1] = []
        self.dslinks_cache[id1].append((id1, idx1, id2, idx2, order))

    def link_rm(self, id1, idx1, id2, idx2, order):
        n1 = self.root.subnodes[id1]
        n2 = self.root.subnodes[id2]
        remove_connection(n1, idx1, n2, idx2, order)
        # caching
        lst = self.dslinks_cache[id1]
        idx = lst.index((id1, idx1, id2, idx2, order))
        del lst[idx]

    def node_label(self, id, label):
        print("node (%s) label clange (%s) always ignored." % (id, label))
        # caching
        e = self.node_cmds_cache[id]
        self.node_cmds_cache[id] = (e[0], e[1], e[2], e[3], label, e[5])

    def node_data(self, id, data_str):
        '''
        This method does not simply set data, but:
        - only nodes of type ObjNode are touched
        - None results in data deletion
        - any json (incl. empty string) results in a tried inject_json call on the object, if any
        '''
        n = self.root.subnodes[id]
        if not type(n) in [ObjNode, ObjLitteralNode]:
            print('node_data ignored for node of type "%s"' % type(n))
            return

        if data_str == None:
            n.assign(None)
            print('node_data assigning None to object of node "%s"' % n.name)
            return

        # deserialise
        obj = None
        try:
            obj = json.loads(data_str)
        except:
            print("node_data input could not be deserialised")
            return

        # assign / set
        if obj == None:
            # clear-functionality enabled by setting even userdata = null
            n.assign(None)
        elif type(n) is ObjLitteralNode:
            n.assign(obj)
            print('node_data assigning deserialised input to litteral object node "%s"' % n.name)
        else:
            try:
                n.obj.set_user_data(obj)
                print('node_data injected into node "%s"' % n.name)
            except Exception as e:
                # set_user_data does not have to be implemented
                print('node_data failed to set data "%s" on node "%s" (%s)' % (data_str, n.name, str(e)))

    def graph_update(self, redo_lsts):
        ''' takes an undo-redo list and sequentially modifies the server-side graph '''
        for redo in redo_lsts:
            cmd = redo[0]
            args = redo[1:]
            try:
                getattr(self, cmd)(*args)
            except:
                print('failed graph update call "%s"' % cmd)

    def execute_node(self, id):
        ''' execute a node and return a json representation of the result '''
        n = self.root.subnodes[id]
        try:
            obj = execute_node(n)
            print("exe %s yields: %s" % (id, str(obj)))
            print("returning json representation...")
            represent = obj.get_repr()
            return represent
        except NodeNotExecutableException:
            print("exe %s yields: Node is not executable")
            return None

    def extract_graphdef(self):
        ''' extract and return a frontend-readable graph definition '''
        gdef = {}
        gdef["nodes"] = {}
        #gdef["datas"] = {}
        gdef["links"] = {}
        for key in self.root.subnodes.keys():
            gdef["nodes"][key] = self.node_cmds_cache[key] # will tuples be jsonized as lists?
            # datas here (unimplemented
            try:
                gdef["links"][key] = self.dslinks_cache[key]
            except:
                pass # not all nodes have outgoing links...
        return gdef


basetypes = {
    'object' : ObjNode,
    'object_litteral' : ObjLitteralNode,
    'function' : FuncNode,
    'function_named' : FuncNode,
    'method' : MethodNode,
    'method_as_function' : MethodAsFunctionNode,

    'object_idata' : ObjNode,
    'object_ifunc' : ObjNode,
}


'''
Nodeconf generation section
'''

def get_module_classes_and_functions(podule):
    ''' investigates a module (pmodule) and returns all classes, class functions and functions '''
    classes = []
    functions = []

    inspect.getmembers(podule)
    for modmem in inspect.getmembers(podule):
        # get classes
        if inspect.isclass(modmem[1]):
            cls = {}
            cls['class'] = modmem[1]
            cls['methods'] = []
            methods = cls['methods']
            # get methods (which are typed as functions when on a class object, rather than an instantiated)
            for m in inspect.getmembers(modmem[1], None):
                obj = m[1]
                if inspect.isfunction(obj):
                    if not re.match('_', obj.__name__):
                        methods.append(obj)
            classes.append(cls)
        # get functions
        elif inspect.isfunction(modmem[1]):
            fct = modmem[1]
            functions.append(fct)

    return classes, functions

def save_nodetypes_js(mypath, tree, addrss):
    text_addrss = 'var nodeAddresses = ' + json.dumps(addrss, indent=2) + ';\n\n'
    text = 'var nodeTypes = ' + json.dumps(tree.root, indent=2) + ';\n\n'

    fle = open(os.path.join(mypath, "nodetypes.js"), 'w')
    fle.write(text_addrss + text)
    fle.close()

def save_nodeconfs_addresses_json(tree, addrss):
    text = json.dumps(tree.root, indent=2)
    text_addrss = json.dumps(addrss, indent=2)

    fle = open("types.json", 'w')
    fle.write(text)
    fle.close()

    fle = open("addresses.json", 'w')
    fle.write(text_addrss)
    fle.close()

def save_modulename_json(module_name, package_name):
    text = '{ "module" : "%s", "package" : "%s" }\n' % (module_name, package_name)

    fle = open("pmodule.json", 'w')
    fle.write(text)
    fle.close()

class NodeConfig:
    ''' will be converted to a json record, includes generative funtions for the "special" node confs '''
    def __init__(self):
        self.basetype = ''
        self.address = ''
        self.type = ''
        self.ipars = []
        self.itypes = []
        self.otypes = []
        self.static = 'false' # denotes whether node's data must stay fixed after its construction
        self.executable= 'false' # can the frontend run the node
        self.edit = 'false' # can the user edit the data (undo-able)
        self.name = ''
        self.label = ''

    def make_function_like(self, address, funcname, args):
        self.type = funcname
        self.address = address
        self.ipars = args
        for a in args:
            self.itypes.append('')
        self.otypes = ['']
        self.static = 'true'
        self.executable = 'false'
        self.edit = 'false'
        self.name = funcname
        self.label = funcname[0]

    def make_function_like_wtypehints(self, address, funcname, args, annotations):
        self.type = funcname
        self.address = address
        self.ipars = args
        self.itypes = [annotations[a].__name__ for a in args]
        self.otypes = ['']
        if 'return' in annotations:
            self.otypes = [annotations['return'].__name__]
        self.static = 'true'
        self.executable = 'false'
        self.edit = 'false'
        self.name = funcname
        self.label = funcname[0:5]

    def make_object(self, branch):
        self.type = 'obj'
        self.address = '.'.join([branch, 'obj'])
        self.basetype = 'object'
        self.static = 'false'
        self.executable = 'true'
        self.edit = 'false'

    def make_litteral(self, branch):
        self.type = 'litteral'
        self.address = '.'.join([branch, 'litteral'])
        self.basetype = 'object_litteral'
        self.data = {}
        self.static = 'false'
        self.executable = 'false'
        self.edit = 'true'

    def make_idata(self, branch):
        self.type = 'idata'
        self.address = '.'.join([branch, 'idata'])
        self.basetype = 'object_idata'
        # superfluous?
        self.itypes = ['IData']
        # superfluous?
        self.otypes = ['IData']
        self.static = 'false'
        self.executable = 'true'
        self.edit = 'false'

    def make_ifunc(self, branch):
        self.type = 'ifunc'
        self.address = '.'.join([branch, 'ifunc'])
        self.basetype = 'object_ifunc'
        # superfluous?
        self.itypes = ['IFunc']
        # superfluous?
        self.otypes = ['IFunc']
        self.static = 'false'
        self.executable = 'true'
        self.edit = 'true'

    def get_repr(self):
        if self.basetype == '':
            raise Exception("basetype not set")
        if self.type == '':
            raise Exception("type not set")

        dct = OrderedDict([
            ("basetype", self.basetype),
            ("type", self.type),
            ("address", self.address),
            ("ipars", self.ipars),
            ("itypes", self.itypes),
            ("otypes", self.otypes),
            ("static", self.static),
            ("executable", self.executable),
            ("edit", self.edit),
            ("name", self.name),
            ("label", self.label)
        ])
        return dct

def ctypeconf_tree_ifit(classes, functions):
    ''' creates complete "flatext" conf types json file from a python module and some defaults '''
    # TODO: load typehints

    tree = TreeJsonAddr()
    addrss = [] # currently lacking an iterator, we save all adresses to allow iterative access to the tree
    def get_key(conf):
        return conf['type']

    # create default conf types

    # object
    obj = NodeConfig()
    obj.make_object('handles')
    tree.put('handles', obj.get_repr(), get_key)
    addrss.append(obj.address)

    # object_litteral
    litteral= NodeConfig()
    litteral.make_litteral('handles')
    tree.put('handles', litteral.get_repr(), get_key)
    addrss.append(litteral.address)

    # object_idata
    idata = NodeConfig()
    idata.make_idata('handles')
    tree.put('handles', idata.get_repr(), get_key)
    addrss.append(idata.address)

    # object_ifunc
    ifunc = NodeConfig()
    ifunc.make_ifunc('handles')
    tree.put('handles', ifunc.get_repr(), get_key)
    addrss.append(ifunc.address)

    # create types from a the give classes and functions
    for entry in classes:
        # get class object
        cls = entry['class']
        if cls.__name__ in ['ObjReprJson', 'IFitObject', 'Matlab']:
            continue

        # create constructor node types
        argspec = inspect.getfullargspec(cls.__init__)
        conf = NodeConfig()
        conf.make_function_like_wtypehints('classes.' + cls.__name__, cls.__name__, argspec.args[1:], argspec.annotations)

        # we know the output type for constructors...
        conf.otypes[0] = cls.__name__
        # HERE BE HAX
        if cls.__name__ in ['Gauss', 'Lorentz', 'Const', 'Lin']:
            conf.otypes[0] = 'IFunc'

        conf.basetype = 'function_named'
        tree.put('classes', conf.get_repr(), get_key)
        addrss.append(conf.address)

        # create method node types
        methods = entry['methods']
        for m in methods:
            if m.__name__ in ['get_repr', 'set_user_data', 'varname', 'inject_ifit_data']:
                continue

            argspec = inspect.getfullargspec(m)
            conf = NodeConfig()
            conf.make_function_like(address='classes.%s.%s' % (cls.__name__, m.__name__), funcname=m.__name__, args=argspec.args)
            conf.basetype = "method_as_function"
            tree.put('classes.' + cls.__name__, conf.get_repr(), get_key)
            addrss.append(conf.address)

    for f in functions:
        # create function node types
        argspec = inspect.getfullargspec(f)
        conf = NodeConfig()
        conf.make_function_like_wtypehints('functions.'+f.__name__, f.__name__, argspec.args, argspec.annotations)
        conf.basetype = 'function_named'
        tree.put('functions', conf.get_repr(), get_key)
        addrss.append(conf.address)

    return tree, addrss

def ctypeconf_tree_simple(classes, functions):
    ''' creates complete "flatext" conf types json file from a python module and some defaults '''
    tree = TreeJsonAddr()
    addrss = [] # currently lacking an iterator, we save all adresses to allow iterative access to the tree
    def get_key(conf):
        return conf['type']

    # create default conf types
    obj = NodeConfig()
    obj.make_object()
    tree.put('', obj.get_repr(), get_key)
    addrss.append(obj.address)
    pars = NodeConfig()
    pars.make_litteral()
    tree.put('', pars.get_repr(), get_key)
    addrss.append(pars.address)

    # create types from a the give classes and functions
    for entry in classes:
        cls = entry['class']

        # create constructor node types
        argspec = inspect.getargspec(cls.__init__)
        conf = NodeConfig()
        conf.make_function_like(cls.__name__, cls.__name__, argspec.args[1:]) # omit the "self" arg, which is not used in the constructor...
        # we know this output type
        conf.otypes[0] = cls.__name__
        conf.basetype = 'function_named'
        tree.put('', conf.get_repr(), get_key)
        addrss.append(conf.address)

        # create method node types
        methods = entry['methods']
        for m in methods:
            argspec = inspect.getargspec(m)
            conf = NodeConfig()
            conf.make_function_like(address='%s.%s' % (cls.__name__, m.__name__), funcname=m.__name__, args=argspec.args)
            conf.basetype = "method_as_function"
            tree.put(cls.__name__, conf.get_repr(), get_key)
            addrss.append(conf.address)

    for f in functions:
        # create function node types
        argspec = inspect.getargspec(f)
        conf = NodeConfig()
        conf.make_function_like(f.__name__, f.__name__, argspec.args)
        conf.basetype = 'function_named'
        tree.put('', conf.get_repr(), get_key)
        addrss.append(conf.address)

    return tree, addrss
