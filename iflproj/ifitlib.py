'''
iFit-interfaced library used as a base for generating ifitlab node types.

Notes on node type generation:
1) any class, function or method can be is flagged as "non-public" by an underscore prefix in 
its name - e.g. _get_plot_1D - will be omitted.
2) any class can implement the static ObjReprJson.non_polymorphic_typename (annotated by @staticmethod)
whereby its constructor node will output that type name

Notes on class features:
1) inherit all classes from ObjReprJson
2) implement get_repr and set_user_data to interact with low-level data. Extend or use _get_full_repr_dict only.
3) implement non_polymorphic_typename (annotated with @staticmethod) if you want to overload 
the node type of the resulting constructor node
4) any parameter with a default value will not give rise to a node anchor, but rathe a configurable value on the
actual node in the gui. Use this for function configuration options that are better suited for this minor or 
secondary presence
'''
__author__ = "Jakob Garde"

import engintf
import scipy.misc
import io
import base64
import matlab.engine
import math
import logging
logging.basicConfig(level=logging.DEBUG)
import numpy as np
import json

_eng = None
_cmdlog = None
def _eval(cmd, nargout=1):
    global _eng
    global _cmdlog
    if not _cmdlog:
        _cmdlog = logging.getLogger('cmds')
        hdlr = logging.FileHandler('cmds.log')
        formatter = logging.Formatter('%(message)s')
        hdlr.setFormatter(formatter)
        _cmdlog.addHandler(hdlr) 
        _cmdlog.info("")
        _cmdlog.info("")
        _cmdlog.info("%%  starting ifit cmd log session  %%")
    if not _eng:
        _eng = matlab.engine.start_matlab('-nodesktop -nosplash', async=False)
        _eng.eval("addpath(genpath('/home/jaga/source/REPO_ifit'))")
    _cmdlog.info(cmd)
    return _eng.eval(cmd, nargout=nargout)

_ifuncidx = -1
_idataidx = -1;
def _get_ifunc_prefix():
    global _ifuncidx
    _ifuncidx += 1
    return 'ifunc%d' % (_ifuncidx)
def _get_idata_prefix():
    global _idataidx
    _idataidx += 1
    return 'idata%d' % (_idataidx)

class IData(engintf.ObjReprJson):
    def __init__(self, url: str):
        logging.debug("IData.__init__('%s')" % url)
        self.url = url
        self.varname = '%s_%d' % (_get_idata_prefix(), id(self))
        self.islist = False
        self.datashape = None
        if url==None:
            '''
            NOTE: This branch (url==None) is to be used only programatically, as a "prepper" intermediary
            state to get a varname from python, before assigning an actual ifit object, for example while
            executing (the python-side bookkeeping of) functions like fits or eval.
            '''
            pass
        else:
            _eval("%s = iData('%s')" % (self.varname, url), nargout=0)

    def _get_iData_repr(self):
        varname = self.varname
        ndims = int(_eval('ndims(%s)' % varname))
        axes_names = _eval('%s.Axes' % varname, nargout=1) # NOTE: len(axes_names) == ndims
        if not ndims == len(axes_names):
            # TODO: handle this case in which ifit has not found any axes in the data
            raise Exception("ifit could not find axes")
        axesvals = []
        pltdct = {}

        # get signal
        if ndims == 1:
            xvals = _eval('%s.%s;' % (varname, axes_names[0]))
            if len(xvals)==1:
                try:
                    xvals = xvals[0]
                except:
                    pass
            xvals = np.reshape(xvals, (1, len(xvals)))[0].tolist()
            axesvals.append(xvals)

            signal = np.array(_eval('%s.Signal;' % varname, nargout=1)).astype(np.float)
            signal = np.reshape(signal, (1, len(signal)))[0].tolist()
            try:
                error = np.array(_eval('%s.Error;' % varname, nargout=1)).astype(np.float)
                error = np.reshape(error, (1, len(error)))[0].tolist()
            except:
                error = np.sqrt(signal).tolist()

            pltdct = _get_plot_1D(axesvals, signal, error, xlabel='x', ylabel='y', title=self.varname)
        elif ndims == 2:
            xvals = list(_eval('%s.%s;' % (varname, axes_names[0]) )[0])
            yvals = list(_eval('%s.%s;' % (varname, axes_names[1]) )[0])
            axesvals.append(xvals)
            axesvals.append(yvals)

            signal = np.array(_eval('%s.Signal;' % varname, nargout=1)).astype(np.float).tolist()
            error = np.array(_eval('%s.Error;' % varname, nargout=1)).astype(np.float).tolist()
            
            pltdct = _get_plot_2D(axesvals, signal, error, xlabel='monx', ylabel='mony', title=self.varname)
        else:
            for i in range(ndims):
                ivals = list(_eval('%s.%s' % (varname, axes_names[i]) )[0])
                axesvals.append(ivals)
            signal = list(_eval('%s.Signal;' % varname)[0])
            error = list(_eval('%s.Error;' % varname)[0])
        
        infdct = {'datashape' : None}
        infdct['ndims'] = _eval('ndims(%s)' % varname)
        return pltdct, infdct

    def get_repr(self):
        retdct = self._get_full_repr_dict()
        try:
            _eval("%s.Signal;" % self.varname, nargout=0)
        except:
            self.islist = True
            self.datashape = np.array(_eval("size(%s)" % self.varname, nargout=1)[0]).astype(int).tolist()
        
        if not self.islist:
            pltdct, infdct = self._get_iData_repr()
        else:
            pltdct = None
            infdct = {'datashape' : self.datashape, 'ndims' : None}

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct

        return retdct

    def __exit__(self, exc_type, exc_value, traceback):
        _eval("clear %s;" % self.varname)

    def rmint(self, min:float, max:float):
        _eval("xlim(%s, [%f %f], 'exclude')" % (self.varname, min, max), nargout=0)

def _get_plot_1D(axisvals, signal, yerr, xlabel, ylabel, title):
    ''' returns the dict required by the svg 1d plotting function '''
    params = {}
    p = params
    p['w'] = 326
    p['h'] = 220
    p['x'] = axisvals[0]
    p['y'] = signal
    p['yerr'] = yerr
    p['xlabel'] = xlabel
    p['ylabel'] = ylabel
    p['title'] = title
    p['ndims'] = 1
    return params

def _get_plot_2D(axisvals, signal, yerr, xlabel, ylabel, title):
    ''' returns the dict required by the svg 1d plotting function '''
    def lookup(cm, x):
        xp = (len(cm)-1) * x
        f = np.floor(xp)
        c = np.ceil(xp)
        a1 = xp - f
        a2 = c - xp
        # the below should be better, but there are still some strange artefacts in the generated image
        #return np.add(cm[f], (xp-f)*(np.subtract(cm[c], cm[f])) ).astype(np.ubyte)
        return cm[np.int(np.round(xp))]
    
    dims = np.shape(signal)
    
    # create the 2d data as a png given our colormap
    img = np.zeros((dims[0], dims[1], 4))
    maxval = np.max(signal)
    cm = np.array([[0,0,143,255], [0,0,159,255], [0,0,175,255], [0,0,191,255], [0,0,207,255], [0,0,223,255], [0,0,239,255], [0,0,255,255], [0,16,255,255], [0,32,255,255], [0,48,255,255], [0,64,255,255], [0,80,255,255], [0,96,255,255], [0,112,255,255], [0,128,255,255], [0,143,255,255], [0,159,255,255], [0,175,255,255], [0,191,255,255], [0,207,255,255], [0,223,255,255], [0,239,255,255], [0,255,255,255], [16,255,239,255], [32,255,223,255], [48,55,207,255], [64,255,191,255], [80,255,175,255], [96,255,159,255], [112,255,143,255], [128,255,128,255], [143,255,112,255], [159,255,96,255], [175,255,80,255], [191,255,64,255], [207,255,48,255], [223,255,32,255], [239,255,16,255], [255,255,0,255], [255,239,0,255], [255,223,0,255], [255,207,0,255], [255,191,0,255], [255,175,0,255], [255,159,0,255], [255,143,0,255], [255,128,0,255], [255, 112,0, 255], [255,96,0, 255], [255,80,0, 255], [255,64,0, 255], [255,48,0, 255], [255,32,0, 255], [255,16,0, 255], [255,0,0, 255], [239,0,0, 255], [223,0,0, 255], [207,0,0, 255], [191,0,0, 255], [175,0,0, 255], [159,0,0, 255], [143,0,0, 255], [128,0,0, 255]], dtype=np.ubyte)
    for i in range(dims[0]):
        for j in range(dims[1]):
            color = lookup(cm, signal[i][j]/maxval)
            img[i,j,:] = color

    # encode png as base64 string
    image = scipy.misc.toimage(img)
    output = io.BytesIO()
    image.save(output, format="png")
    contents = output.getvalue()
    output.close()
    encoded_2d_data = str(base64.b64encode(contents)).lstrip('b').strip("\'")

    # color bar
    img = np.zeros((256, 1, 4))
    for i in range(256):
        color = lookup(cm, i/255)
        img[255-i, 0] = color
    cb_img = scipy.misc.toimage(img)
    output = io.BytesIO()
    cb_img.save(output, format='png')
    contents = output.getvalue()
    output.close()
    encoded_cb = str(base64.b64encode(contents)).lstrip('b').strip("\'")

    x = axisvals[0]
    y = axisvals[1]
    xmin = np.min(x)
    xmax = np.max(x)
    ymin = np.min(y)
    ymax = np.max(y)

    cb_min = np.min(signal)
    cb_max = np.max(signal)

    params = {}
    p = params
    p['w'] = 326
    p['h'] = 220

    p['xmin'] = xmin
    p['xmax'] = xmax
    p['ymin'] = ymin
    p['ymax'] = ymax

    p['img2dData'] = encoded_2d_data
    p['imgColorbar'] = encoded_cb

    p['cbMin'] = cb_min
    p['cbMax'] = cb_max

    p['xlabel'] = xlabel
    p['ylabel'] = ylabel
    p['title'] = title

    p['ndims'] = 2

    return params

class IFunc(engintf.ObjReprJson):
    '''  '''
    def __init__(self, datashape:list=None, symbol='iFunc'):
        logging.debug("%s.__init__" % str(type(self)))
        self.varname = '%s_%d' % (_get_ifunc_prefix(), id(self))
        vn = self.varname

        _eval("%s = %s()" % (vn, symbol), nargout=0)

    def get_repr(self):
        vn = self.varname
        pkeys = _eval('%s.Parameters;' % vn, nargout=1)
        pvals = {}
        for key in pkeys:
            idx = pkeys.index(key)
            key0 = key.split(' ')[0]
            val = _eval('%s.%s' % (vn, key0), nargout=1)
            while type(val) == list:
                val = val[0]
            if type(val) != float:
                pvals[key] = None
            elif math.isnan(float(val)):
                pvals[key] = None
            else:
                pvals[key] = val

        retdct = self._get_full_repr_dict()
        retdct['userdata'] = pvals
        return retdct

    def set_user_data(self, json_obj):
        vn = self.varname
        pkeys = _eval('%s.Parameters;' % vn)
        for key in pkeys:
            try:
                val = json_obj[key]
                key0 = key.split(' ')[0]
                if val != None:
                    _eval('p_%s.%s = %s;' % (vn, key0, val), nargout=0)
            except:
                print('IFunc.set_user_data: set failed for param "%s" to val "%s"' % (key, val))
                continue
        _eval('%s.ParameterValues = struct2cell(p_%s)' % (vn, vn), nargout=0)
        _eval('clear p_%s' % vn, nargout=0)

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self.varname
        _eval(cmd)

    def guess(self, guess: dict):
        ''' applies a guess to the parameters of this instance '''
        pkeys = _eval('%s.Parameters;' % self.varname, nargout=1)
        vn = self.varname

        for key in pkeys:
            try:
                key0 = key.split(' ')[0]

                val = guess.get(key0, None)
                if val == None:
                    val = 'NaN'
                _eval('p_%s.%s = %s;' % (vn, key0, val), nargout=0)
            except:
                pass
        _eval('%s.ParameterValues = struct2cell(p_%s)' % (vn, vn), nargout=0)
        pass

    def fixpars(self, parnames: list):
        vn = self.varname
        allpars = _eval('%s.Parameters;' % vn, nargout=1)
        fix = parnames
        dontfix = [p for p in allpars if p not in fix]
        for p in fix:
            _eval("fix(%s, %s)" % (vn, p), nargout=0)
        for p in dontfix:
            _eval("munlock(%s, %s)" % (vn, p), nargout=0)

        # TESTING:
        # - this does not work: fix([a b], ['Centre' 'Amplitude'])
        # - this works : fix([a b], 'Amplitude')
        # DO we need a manual vectorization?
        # should we pick a general solution, e.g. numpy vectorization, and execute all atomic calls in matlab?


        '''
        Hello Jakob,

        if you have a model g, e.g.
        
        * g = gauss;
        
        then to fix some parameter you may use the following syntax:
        
        * g.Amplitude = 'fix';
        * g.Amplitude = 'lock';
        * fix(g, 'Amplitude');
        * fix(g, 1); % if Amplitude is the 1st parameter
        * fix(g, 'all'); fix all
        * mlock(g, 'Amplitude'); % mlock == fix
        
        to free parameters:
        
        * fix(g, 'none'); % free all parameters
        * munlock(g, 'Amplitude')
        * munlock(g, 1)
        * g.Amplitude = 'free'; % or 'clear' or 'unlock'
        
        except for direct assignment, all method calls return the modified
        object (and if possible update the initial object itself).
        
        To get the list of all fixed/locked parameters:
        
        * mlock(g)
        
        to get the unlock/free parameters:
        
        * munlock(g)
        
        Cheers, Emmanuel.
        '''


'''
constructor functions for various models, easy-gen substitutes for class constructors
'''
def Gauss(datashape:list=None) -> IFunc:
    return IFunc(datashape, 'gauss')

def Lorentz(datashape:list=None) -> IFunc:
    return IFunc(datashape, 'lorz')

def Lin(datashape:list=None) -> IFunc:
    return IFunc(datashape, 'strline')


'''
ifunc combination functions / operators
'''
def add(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("add: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname
    vn2 = ifunc_b.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = %s + %s;' % (vn_new, vn1, vn2))
    return obj

def subtr(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("subtr: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname
    vn2 = ifunc_b.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = %s - %s;' % (vn_new, vn1, vn2))
    return obj

def mult(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("mult: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname
    vn2 = ifunc_b.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = %s * %s;' % (vn_new, vn1, vn2))
    return obj

def div(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("div: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname
    vn2 = ifunc_b.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = %s / %s;' % (vn_new, vn1, vn2))
    return obj

def trapz(ifunc: IFunc) -> IFunc:
    logging.debug("trapz: %s" % ifunc)
    vn_old = ifunc.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = trapz(%s)' % (vn_new, vn_old))
    return obj

'''
functions (also called "methods" in the ifit documentation
'''
def eval(idata: IData, ifunc: IFunc):
    logging.debug("eval: %s, %s" % (idata, ifunc))
    retobj = IData(None)
    
    _eval("%s = %s(%s);" % (retobj.varname, idata.varname, ifunc.varname), nargout=0)
    return retobj

def fit(idata: IData, ifunc: IFunc) -> IFunc:
    logging.debug("fit: %s, %s" % (idata, ifunc))
    vn_oldfunc = ifunc.varname
    vn_data = idata.varname
    retobj = IFunc()
    vn_newfunc = retobj.varname
    _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s))' % (vn_newfunc, vn_data, vn_oldfunc), nargout=0)
    _eval('%s = o_%s.model' % (vn_newfunc, vn_newfunc), nargout=0)
    _eval('clear o_%s' % vn_newfunc, nargout=0)
    return retobj


def _isirregular(lst):
    ''' returns true if the input arbitrarily nested list is irregular, e.g. has sublists of varying length '''
    def _isirregular_rec(l):
        len0 = None
        for i in range(len(l)):
            nxt = l[i]
            if type(nxt) in (list, np.ndarray):
                if not len0:
                    len0 = len(nxt)
                _isirregular_rec(nxt)
                if len(nxt) != len0:
                    raise Exception("array not regular")
    try:
        _isirregular_rec(lst)
        return False
    except:
        return True

def _create_ml_array(varname, lst):
    _eval("%s = zeros%s;" % (varname, str(np.shape(lst))), nargout=0)

def _ml_vectoreval_exprfunc(arr, varname, atomic_mlexpr_func):
    it = np.nditer(arr, flags=['multi_index'])
    while not it.finished:
        expr = atomic_mlexpr_func(element=arr[it.multi_index])
        indices = [i+1 for i in it.multi_index]
        indices = str(indices).replace("[","(").replace("]",")")
        _eval("%s%s = %s;" % (varname, indices, expr), nargout=0)
        it.iternext()

def _plustwo_expr(element:int):
    return "%d + 2" % (element)

def _maprec(lst, rank, innerfunc):
    ''' data-shape preserving map recursive given index depth "rank" '''
    for i in range(len(lst)):
        if rank > 1:
            _maprec(lst[i], rank-1, innerfunc)
        else:
            lst[i] = innerfunc(lst[i])
    return lst

def combine(filename, rank:int=0) -> IData:
    ''' a data reduce / merges which is vectorized explicitly for rank>0'''
    logging.debug("combine")
    
    def atomicfunc(filesvals):
        obj = IData(None)
        # enable flexibility: a list is not needed for single-file arguments, remember this is the inner func
        if type(filesvals) != list:
            filesvals = [filesvals];
        vnlst= []
        for i in range(len(filesvals)):
            tmpvarname = "%s_tmp_%d" % (obj.varname, i)
            _eval("%s = iData('%s');" % (tmpvarname, filesvals[i]), nargout=0)
            vnlst.append(tmpvarname)
        _eval("%s = combine([%s]);" % (obj.varname, ' '.join(vnlst)), nargout=0)
        # clear the temporary variables in matlab
        for varname in vnlst:
            _eval("clear %s;" % varname, nargout=0)
        return obj
    
    # TODO: check if files is uniform of size (down to rank)?
    
    # rank: denotes the number of indices required to identify each element individually
    retobj = IData(None)
    if rank==0:
        retobj = atomicfunc(filename)
    else:
        idatas = np.asarray(_maprec(filename, rank, atomicfunc))
        varnames = np.vectorize(lambda d: d.varname)(idatas)
        avarnames_str = json.dumps(varnames.tolist()).replace('"','')
        _eval("%s = %s;" % (retobj.varname, avarnames_str), nargout=0)

    return retobj


'''
NOTES on vectorization scheme:

- an atomic function is needed
- we shall only accept regular arrays as input (n-dim rectangles)
- more than one ndarray arg can be expected, but the vectorization shape is fixed 
- vectorization shape can be specified from the "primary" object ndarray, allowing the 
rest to end up being e.g. lists corresponding to objects at the same indices of the primary
- we don't want matlab-side vectorization as it is used as a script (one-liners)
- we have two vectorization schemes: one using rank, and one using shape directly

'''

