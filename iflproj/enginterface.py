'''
Nodespeak extension using a single root node and one layer of sub-nodes.

This module depends on nodespeak, and acts in accordance with the requirements 
of the graphui js frontend.
'''
__author__ = "Jakob Garde"

import logging
import inspect
import json
import re
import os
import sys
import base64
from collections import OrderedDict
import traceback

from nodespeak import RootNode, FuncNode, ObjNode, MethodNode, MethodAsFunctionNode, add_subnode, remove_subnode
from nodespeak import add_connection, remove_connection, execute_node, NodeNotExecutableException, InternalExecutionException, ObjLiteralNode
from loggers import log_engine as _log


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

    def put(self, path, item, getkey):
        root = self.root
        branch = root
        if path != '' and not path[0] == '.':
            branch = self._descend_recurse(root, path)['branch']
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

class ObjectRepresentationException(Exception): pass

class ObjReprJson:
    '''
    to serialize objects to the fron-end, requires a js readable like json
    '''
    @staticmethod
    def non_polymorphic_typename():
        return 'ObjReprJson'
    def _get_full_repr_dict(self):
        ''' people can overload get_repr without having to call super, but just get the standard dict format from this method '''
        ans = OrderedDict()
        ans['info'] = {'__class__' : str(self.__class__) }
        ans['userdata'] = ''
        ans['plotdata'] = ''
        return ans
    def get_repr(self):
        dct = self._get_full_repr_dict()
        return dct
    def set_user_data(self, json_obj):
        pass

class MiddleWare:
    ''' graph return obj registration and finalize (abstracted from use case: clear Matlab variables @ session end) '''
    class WasAlreadyFinalizedException(Exception): pass
    def __init__(self):
        self.was_finalized = False
    def register(self, obj):
        pass
    def get_save_fct(self):
        return getattr(self, "save")
    def get_load_fct(self):
        return getattr(self, "load")
    def finalize(self):
        if self.was_finalized:
            raise MiddleWare.WasAlreadyFinalizedException()
        self.was_finalized = True

'''
Id- and type based graph manipulation interface.

NOTE: "id" here is referred to as "name" in the nodespeak module.
'''

'''
WARNING: The presense of flatgraph_pmodule global variable is a hack that enables
Pickling of FlatGraph instances. Every time a new FG object is loaded, it will
be reset. This means that the pmodule constructor argument must always be
the same.
'''
flatgraph_pmodule = None

'''
A "flat" nodespeak graph, in the sense that as a tree, the graph has at most two 
layers: The root and its children. This simple nodespeak graph handling 
implementation is the only available one at the time of writing.
'''
class FlatGraph:
    def __init__(self, tpe_tree, pmodule):
        global flatgraph_pmodule
        flatgraph_pmodule = pmodule
        
        self.root = RootNode("root")
        self.tpe_tree = tpe_tree

        self.coords = None # should be reset with every execute syncset, and by inject_graphdef

        self.node_cmds_cache = {}
        self.dslinks_cache = {} # ds = downstream

        self.middleware = None
        load_mw = getattr(pmodule, "_load_middleware")
        if load_mw:
            self.middleware = load_mw()

    def _create_node(self, id, tpe_addr):
        '''
        id - node id
        tpe_addr - node type address
        '''
        conf = self.tpe_tree.retrieve(tpe_addr)
        n = None
        node_tpe = basetypes[conf['basetype']]
        if node_tpe == ObjNode:
            n = ObjNode(id, None)
        elif node_tpe == ObjLiteralNode:
            n = ObjLiteralNode(id, None)
        elif node_tpe == FuncNode:
            func = getattr(flatgraph_pmodule, conf['type'])
            n = FuncNode(id, func)
        elif node_tpe == MethodAsFunctionNode:
            n = MethodAsFunctionNode(id, conf['type'])
        elif node_tpe == MethodNode:
            n = MethodNode(id, conf['type'])
        return n

    def node_add(self, x, y, id, name, label, tpe):
        n = self._create_node(id, tpe)
        _log('created node (%s) of type: "%s", content: "%s"' % (id, str(type(n)), str(n.get_object())))
        add_subnode(self.root, n)
        # caching
        self.node_cmds_cache[id] = (x, y, id, name, label, tpe)

    def node_rm(self, id):
        n = self.root.subnodes.get(id, None)
        if not n:
            return
        
        obj = n.get_object()
        if obj != None:
            self.middleware.deregister(obj)
        
        if n.num_parents() != 0 or n.num_children() != 0:
            raise Exception("node_rm: can not remove node with existing links")
        remove_subnode(self.root, n)
        # caching
        del self.node_cmds_cache[id]
        _log("deleted node: %s" % id)

    def link_add(self, id1, idx1, id2, idx2, order=0):
        n1 = self.root.subnodes[id1]
        n2 = self.root.subnodes[id2]
        
        # "method links" are represented in the frontend as idx==-1, but as an owner/subnode relation in nodespeak
        if idx1 == -1 and idx2 == -1:
            if type(n1) == ObjNode and type(n2) == MethodNode:
                add_subnode(n1, n2)
            elif type(n1) == MethodNode and type(n2) == ObjNode:
                add_subnode(n2, n1)
        # all other connections
        else:
            add_connection(n1, idx1, n2, idx2, order)

        # caching
        if not self.dslinks_cache.get(id1, None):
            self.dslinks_cache[id1] = []
        self.dslinks_cache[id1].append((id1, idx1, id2, idx2, order))

        _log("added link from (%s, %d) to (%s, %d)" % (id1, idx1, id2, idx2))

    def link_rm(self, id1, idx1, id2, idx2, order=0):
        n1 = self.root.subnodes[id1]
        n2 = self.root.subnodes[id2]
        
        # method links are represented in the frontend as idx==-1, but as an owner/subnode relation in nodespeak
        if type(n1) == ObjNode and type(n2) == MethodNode and idx1 == -1 and idx2 == -1:
            remove_subnode(n1, n2)
        elif type(n1) == MethodNode and type(n2) == ObjNode and idx1 == -1 and idx2 == -1:
            remove_subnode(n2, n1)
        # all other connections
        else:
            remove_connection(n1, idx1, n2, idx2, order)

        # caching
        lst = self.dslinks_cache[id1]
        idx = lst.index((id1, idx1, id2, idx2, order))
        del lst[idx]
        _log("removed link from (%s, %d) to (%s, %d)" % (id1, idx1, id2, idx2))

    def node_label(self, id, label):
        # TODO: remember node label changes to be able to generate a proper graphdef

        _log("node label update always ignored, (%s, %s)." % (id, label))
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
        if not type(n) in [ObjNode, ObjLiteralNode, FuncNode, MethodAsFunctionNode]:
            _log('node_data ignored for node of type "%s"' % type(n))
            return

        if data_str == None:
            n.assign(None)
            _log('node_data assigning None to object of node "%s"' % n.name)
            return

        # deserialise
        obj = None
        try:
            obj = json.loads(data_str)
        except:
            _log("node_data input could not be deserialised")
            return

        # assign / set
        if obj == None:
            # clear-functionality enabled by setting even userdata = null
            n.assign(None)
            _log("node_data clearing node: %s" % id)
        elif type(n) in (ObjLiteralNode,):
            n.assign(obj)
            _log('node_data assigning to literal "%s"' % n.name)
        elif type(n) in (FuncNode, MethodAsFunctionNode, ):
            n.assign(obj)
            _log("node_data assigning to FuncNode or MethodAsFunctionNode %s" % n.name)
        else:
            try:
                n.get_object().set_user_data(obj)
                _log('node_data injected into node "%s"' % n.name)
            except Exception as e:
                # set_user_data does not have to be implemented
                _log('node_data failed to set data "%s" on node "%s" (%s)' % (data_str, n.name, str(e)), error=True)
                raise e

    def graph_update(self, redo_lsts):
        ''' takes an undo-redo list and sequentially modifies the server-side graph '''
        _log('graph update: %d commands' % len(redo_lsts))
        error = None
        def erracc(msg, s):
            ''' message accumulation '''
            if s == None:
                s = msg
            else:
                s = s + ", " + msg

        for redo_molecule in redo_lsts:
            for redo in redo_molecule:
                cmd = redo[0]
                args = redo[1:]
                try:
                    getattr(self, cmd)(*args)
                except Exception as e:
                    _log('graph update failed, cmd "%s" with: %s' % (redo, str(e)), error=True)
                    erracc(str(e), error)

        if error != None:
            return {'error' : error}

    def graph_coords(self, coords):
        ''' updates the cached node_add commands x- and y-coordinate entries '''
        keys = coords.keys()
        for key in keys:
            coord = coords[key]
            cached_cmd = self.node_cmds_cache[key]
            self.node_cmds_cache[key] = (coord[0], coord[1], cached_cmd[2], cached_cmd[3], cached_cmd[4], cached_cmd[5])
        _log('graph coords: %d coordinate sets' % len(keys))

    def execute_node(self, id):
        ''' execute a node and return a json representation of the result '''
        _log("execute_node: %s" % id)
        try:
            n = self.root.subnodes[id]

            # deregister and clear any previous object
            old = n.get_object()
            if old != None:
                self.middleware.deregister(old)

            # execute (assigns a new object or None), log and register
            obj = self.middleware.execute_through_proxy( lambda _n=n: execute_node(_n) )
            # NOTE: deregistration is handled through the execute proxy call

            _log("exe yields: %s" % str(obj))
            _log("returning json representation...")

            retobj = {'dataupdate': {} }
            update_lst = [id]
            if type(n) in (MethodAsFunctionNode, ):
                update_lst.append([o[0].name for o in n.parents if type(o[0])==ObjNode ][0]) # find "owner" id...
            if type(n) in (MethodNode, ):
                update_lst.append([o.name for o in n.owners if type(o) == ObjNode][0]) # find "owner" id...
            for key in update_lst:
                try:
                    retobj['dataupdate'][key] = None
                    m = self.root.subnodes[key]
                    if m.exemodel().can_assign():
                        objm = m.get_object()
                        if objm:
                            retobj['dataupdate'][key] = objm.get_repr()
                except Exception as e:
                    s = traceback.format_exc()
                    raise ObjectRepresentationException(s)
            return retobj

        except InternalExecutionException as e:
            _log("internal error during exe (%s): %s - %s" % (id, e.name, str(e)), error=True)
            return {'error' : "InternalExecutionException:\n%s" % str(e), 'errorid' : e.name}
        except NodeNotExecutableException as e:
            _log("node is not executable (%s)" % id, error=True)
            return {'error' : "NodeNotExecutableException:\n%s, %s" % (str(e), id)}
        except ObjectRepresentationException as e:
            _log("object representation error... %s" % str(e), error=True)
            return {'error' : "ObjectRepresentationException:\n%s" % str(e)}
        except Exception as e:
            _log("Exotic engine error (%s): %s" % (id, str(e)), error=True)
            return {'error' : "%s: %s" % (type(e).__name__, str(e))}

    def reset_all_objs(self):
        ''' assigns None to all object handle nodes '''
        for key in self.root.subnodes.keys():
            n = self.root.subnodes[key]
            obj = n.get_object()

            if obj != None and type(n) in (ObjNode, ):
                self.middleware.deregister(obj)
                n.assign(None)

    def inject_graphdef(self, graphdef):
        ''' adds nodes, links and datas to the graph '''
        nodes = graphdef['nodes']
        links = graphdef['links']
        datas = graphdef['datas']

        for key in nodes.keys():
            cmd = nodes[key]
            self.node_add(cmd[0], cmd[1], cmd[2], cmd[3], cmd[4], cmd[5])

        for key in links.keys():
            for cmd in links[key]:
                self.link_add(cmd[0], cmd[1], cmd[2], cmd[3], cmd[4])

        for key in datas.keys():
            n = self.root.subnodes[key]
            if type(n) in (ObjLiteralNode, FuncNode, MethodAsFunctionNode, MethodNode ):
                obj = json.loads(str(base64.b64decode( datas[key] ))[2:-1])
                try:
                    n.assign(obj)
                except:
                    print(obj)
            else:
                _log("inject: omiting setting data on node of type: %s" % str(type(n)), error=True)

    def extract_graphdef(self):
        ''' extract and return a frontend-readable graph definition, using the x_y field to insert these into the gd '''
        _log("extracting graph def...")
        gdef = {}
        gdef["nodes"] = {}
        gdef["links"] = {}
        gdef["datas"] = {}
        gdef["labels"] = {}
        for key in self.root.subnodes.keys():
            # nodes
            gdef["nodes"][key] = self.node_cmds_cache[key]

            # links
            try:
                gdef["links"][key] = self.dslinks_cache[key]
            except:
                pass # not all nodes have outgoing links...
            # labels
            # TODO: impl.

            # data
            n = self.root.subnodes[key]
            obj = n.get_object()
            if obj != None and type(n) in (ObjLiteralNode, FuncNode, MethodAsFunctionNode,  ):
                gdef["datas"][key] = str( base64.b64encode( json.dumps(obj).encode('utf-8') ))[2:-1]
        return gdef

    def extract_update(self):
        ''' an "update" is a set of non-literal data representations '''
        _log("extracting data update...")
        update = {}
        for key in self.root.subnodes.keys():
            n = self.root.subnodes[key]
            if type(n) in (ObjNode, ):
                obj = n.get_object()
                if obj:
                    update[key] = obj.get_repr()
                else:
                    update[key] = None
        return update

    def shutdown(self):
        ''' forwards any required shutdown commands to the middleware tool '''
        self.middleware.finalise()


basetypes = {
    'object' : ObjNode,
    'object_literal' : ObjLiteralNode,
    'function' : FuncNode,
    'function_named' : FuncNode,
    'method_as_function' : MethodAsFunctionNode,
    'method' : MethodNode,

    'object_idata' : ObjNode,
    'object_ifunc' : ObjNode,
}


'''
Node conf/type generation section

For lib writing docs: See the module 'ifitlib.py' for rules used while writing a module 
intended for on node type generation.
'''

def save_nodetypes_js(mypath, tree, addrss, categories):
    text_categories = 'var categories = ' + json.dumps(categories, indent=2) + ';\n\n'
    text_addrss = 'var nodeAddresses = ' + json.dumps(addrss, indent=2) + ';\n\n'
    text = 'var nodeTypes = ' + json.dumps(tree.root, indent=2) + ';\n\n'

    fle = open(os.path.join(mypath, "nodetypes.js"), 'w')
    fle.write(text_categories + text_addrss + text)
    fle.close()

def save_modulename_json(module_name, package_name):
    text = '{ "module" : "%s", "package" : "%s" }\n' % (module_name, package_name)

    fle = open("pmodule.js", 'w')
    fle.write(text)
    fle.close()

class NodeConfig:
    ''' will be converted to a json record, includes generative funtions for the "special" node confs '''
    def __init__(self):
        self.docstring = ''
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
        self.data = None

    def make_function_like_wtypehints(self, address, funcname, args, annotations, data=None):
        self.type = funcname
        self.address = address
        self.ipars = args
        self.itypes = [annotations[a].__name__ if annotations.get(a, None) else '' for a in args]
        self.otypes = ['']
        if 'return' in annotations:
            self.otypes = [annotations['return'].__name__]
        self.static = 'true'
        self.executable = 'false'
        self.edit = 'true'
        self.name = funcname
        self.label = funcname
        self.data = data

    def make_method_like_wtypehints(self, address, methodname, args, annotations, clsobj, data=None):
        self.type = methodname
        self.address = address
        self.ipars = args
        annotations['self'] = clsobj
        self.itypes = [annotations[a].__name__ if annotations.get(a, None) else '' for a in args]
        if 'return' in annotations:
            self.otypes = [annotations['return'].__name__]
        self.static = 'true'
        self.executable = 'true'
        self.edit = 'true'
        self.name = methodname
        self.label = methodname
        self.data = data

    def make_method_wtypehints(self, address, methodname, args, annotations, clsobj, data=None):
        self.type = methodname
        self.address = address
        self.ipars = args
        annotations['self'] = clsobj
        self.itypes = [annotations[a].__name__ if annotations.get(a, None) else '' for a in args]
        if 'return' in annotations:
            self.otypes = [annotations['return'].__name__]
        self.static = 'true'
        self.executable = 'true'
        self.edit = 'true'
        self.name = methodname
        self.label = methodname
        self.data = data

    def make_object(self, branch):
        self.docstring = "Multipurpose, untyped object handle."
        self.type = 'obj'
        self.address = '.'.join([branch, 'obj'])
        self.basetype = 'object'
        self.static = 'false'
        self.executable = 'true'
        self.edit = 'true'
        self.name = 'object'

    def make_literal(self, branch):
        self.docstring = "Literal value handle."
        self.type = 'literal'
        self.address = '.'.join([branch, 'literal'])
        self.basetype = 'object_literal'
        self.data = None
        self.static = 'false'
        self.executable = 'false'
        self.edit = 'true'
        self.name = 'literal'

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
            ("label", self.label),
            ("data", self.data),
            ("docstring", self.docstring),
        ])
        return dct

def ctypeconf_tree_ifit(classes, functions, namecategories={}):
    '''
    Creates complete "flatext" conf types json file from a python module and some defaults.

    Somewhat specific to the ifitlib module, although not very much.
    '''
    tree = TreeJsonAddr()
    addrss = [] # currently lacking an iterator, we save all adresses to allow iterative access to the tree
    categories = OrderedDict()
    def get_key(conf):
        return conf['type']

    # object_literal
    literal= NodeConfig()
    literal.make_literal('handles')
    tree.put('handles', literal.get_repr(), get_key)
    addrss.append((literal.address, 0))
    
    # object
    obj = NodeConfig()
    obj.make_object('handles')
    tree.put('handles', obj.get_repr(), get_key)
    addrss.append((obj.address, 3))

    categories['handles'] = ""

    def get_args_and_data(func):
        sign = inspect.signature(func)
        data = {}
        args = []
        for k in sign.parameters.keys():
            par = sign.parameters[k]
            if par.default != inspect._empty:
                data[k] = par.default
            else:
                args.append(k)
        return args, data

    # create types from a the give classes and functions
    inputnames = list(namecategories.keys())
    for entry in classes:
        cls = entry['class']
        
        name = cls.__name__
        keyname = name
        category = namecategories.get(keyname, 'classes')
        address = category + "." + name
        path = category

        argspec = inspect.getfullargspec(cls.__init__)
        conf = NodeConfig()
        conf.docstring = cls.__doc__.strip()
        args, data = get_args_and_data(cls.__init__)
        conf.make_function_like_wtypehints(
            address,
            name,
            args[1:],
            argspec.annotations,
            data)
        conf.otypes[0] = cls.__name__

        # set an output type that is compatible with the non-polymorphic nature of graph connectivity rules
        if issubclass(cls, ObjReprJson):
            name = cls.non_polymorphic_typename()
            if not name == ObjReprJson.non_polymorphic_typename():
                conf.otypes[0] = name
        conf.basetype = 'function_named'

        tree.put(path, conf.get_repr(), get_key)
        addrss.append((address, inputnames.index(keyname)))
        categories[category] = ""

        # create method node types
        methods = entry['methods']
        for m in methods:
            classname = cls.__name__
            name = m.__name__
            keyname = classname + '.' + name
            category = namecategories.get(keyname, 'classes')
            address = category + "." + classname + "." + name
            path = category + "." + classname
            
            argspec = inspect.getfullargspec(m)
            conf = NodeConfig()
            conf.docstring = m.__doc__.strip()
            args, data = get_args_and_data(m)
            
            conf.make_method_wtypehints(
                address,
                name,
                args=args[1:],
                annotations=argspec.annotations,
                clsobj=cls,
                data=data)
            conf.basetype = "method"
            
            tree.put(path, conf.get_repr(), get_key)
            addrss.append((address, inputnames.index(keyname)))
            categories[category] = ""

    # create function node types
    for f in functions:
        name = f.__name__
        keyname = name
        category = namecategories.get(keyname, "functions")
        address = category + "." + name
        path = category
        
        argspec = inspect.getfullargspec(f)
        conf = NodeConfig()
        conf.docstring = f.__doc__.strip()
        args, data = get_args_and_data(f)
        # "functions" which are capitalized are assumed to be substitutes for class constructors
        # ..now that the system isn't polymorphic really
        conf.make_function_like_wtypehints(
            address,
            name,
            args,
            argspec.annotations,
            data=data)
        conf.basetype = 'function_named'

        tree.put(path, conf.get_repr(), get_key)
        addrss.append((address, inputnames.index(keyname)))
        categories[category] = ""

    def sortaddrs_keyfunc(entry):
        return entry[1]
    sorted_addrss = sorted(addrss, key=sortaddrs_keyfunc)
    addrss = [key[0] for key in sorted_addrss]
    categories = list(categories.keys())
    
    return tree, addrss, categories


def get_nodetype_candidates(pymodule):
    '''
    Investigate any module and return classes, class methods and functions under the following conditions:
    
    1) Any entity prefixed by underscore ('_') is omitted.
    2) Any class not inheriting from a class name in 'excepted_classes' is omitted.
    '''
    classes = []
    functions = []
    
    # this is the only place to add exceptions
    excepted_classes = [ObjReprJson]

    inspect.getmembers(pymodule)
    for member in inspect.getmembers(pymodule):
        # get classes
        if inspect.isclass(member[1]):
            if member[1].__module__ != pymodule.__name__:
                continue
            clsobj = member[1]
            # rather few and stable exceptions
            if clsobj.__name__ in (excepted_classes):
                continue
            isprivateclass = re.match('_', clsobj.__name__)
            if isprivateclass:
                continue
            
            clsrecord = {}
            clsrecord['class'] = clsobj
            clsrecord['methods'] = []
            
            # get class methods
            # sort out exceptions for method names
            emn = []
            for exccls in excepted_classes:
                if issubclass(clsobj, exccls):
                    emn = emn + [m[0] for m in inspect.getmembers(exccls)]
            # iterate
            for m in inspect.getmembers(clsobj, None):
                obj = m[1]
                if inspect.isfunction(obj):
                    
                    isprivatemethod = re.match('_', obj.__name__)
                    isexceptedmethod = obj.__name__ in emn
                    
                    # record only public methods, where "non-public" are prefixed with an underscore
                    if not isprivatemethod and not isexceptedmethod:
                        clsrecord['methods'].append(obj)
            classes.append(clsrecord)

        # get functions
        elif inspect.isfunction(member[1]):
            fct = member[1]
            isprivatefunction = re.match('_', fct.__name__)
            if not isprivatefunction:
                functions.append(fct)

    return classes, functions
