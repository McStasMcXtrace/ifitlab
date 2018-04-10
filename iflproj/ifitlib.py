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
from iflproj.settings import IFIT_DIR

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
        _eng = matlab.engine.start_matlab('-nojvm -nodesktop -nosplash', async=False)
        _eng.eval("addpath(genpath('%s'))" % IFIT_DIR)
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
    def __init__(self, url, datashape=None):
        '''
        If url is a string datashape must be None.
        Otherwise, url must be an ndarray (nested json lists) of shape matching datashape.
        '''
        logging.debug("IData.__init__('%s')" % url)
        self.varname = '%s_%d' % (_get_idata_prefix(), id(self))

        if url==None:
            '''
            The url==None option can be used programatically to get a varname before assigning an 
            actual ifit object or array or ifit objects, for example while executing functions like 
            fit, eval or combine.
            '''
            return
        
        datashape = _npify_shape(datashape)
        if type(url) != str and not _is_regular_ndarray(url):
            raise Exception("url must be a string or regular ndarray/nested list")
        if str(np.shape(url)) != str(datashape):
            raise Exception("data shape mismatch, shape(url) == %s, datashape == %s" % (str(np.shape(url)), str(datashape)))
        self.url = url
        
        def create_idata(vn, url):
            _eval("%s = iData('%s')" % (vn, url), nargout=0)

        def create_idata_array(vn, shape):
            if len(shape) == 1:
                shape = (shape[0], 1)
            shape = str(list(shape)).replace("[","").replace("]","")
            _eval("%s = zeros(iData, %s);" % (vn, shape), nargout=0)

        if datashape:
            url = np.array(url)
            self.url = url
            create_idata_array(self.varname, datashape)
            vnargs = (self.varname, )
            args = ()
            ndaargs = (url, )
            _vectorized(datashape, create_idata, vnargs, args, ndaargs)
        else:
            create_idata(self.varname, url)

    def _get_iData_repr(self):
        varname = self.varname
        ndims = int(_eval('ndims(%s)' % varname))
        axes_names = _eval('%s.Axes' % varname, nargout=1) # NOTE: len(axes_names) == ndims
        if not ndims == len(axes_names):
            # TODO: handle this case in which ifit has not found any axes in the data
            raise Exception("could not find axes")
        axesvals = []
        pltdct = {}

        # get signal
        if ndims == 0:
            ' the trivial case, no data is present '
            pltdct = None
        elif ndims == 1:
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
        infdct['ndims'] = "%d" % ndims
        return pltdct, infdct

    def _get_datashape(self):
        try:
            _eval("%s.Signal;" % self.varname, nargout=0)
        except:
            s = np.array(_eval("size(%s)" % self.varname, nargout=1)[0]).astype(int).tolist() # NOTE: tolist() converts to native python int from np.int64
            return _npify_shape(s)
        return tuple()

    def get_repr(self):
        retdct = self._get_full_repr_dict()
        # detect if we are a list or a plan iData object
        datashape = self._get_datashape()
        
        if datashape in (None, tuple(),):
            pltdct, infdct = self._get_iData_repr()
        else:
            pltdct = None
            infdct = {'datashape' : datashape, 'ndims' : None} # ndims refers to (individual) data dimensionality

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct

        return retdct

    def __exit__(self, exc_type, exc_value, traceback):
        _eval("clear %s;" % self.varname)

    def rmint(self, min, max):
        ''' removes intervals from idata objects 
        NOTE: a (minmax_lst) signatured version of rmint would require a "rank" or "shape" indexing 
        depth parameter (same as combine).
        '''
        def rmint_atomic(vn, start, end):
            _eval("%s = xlim(%s, [%f %f], 'exclude');" % (vn, vn, start, end), nargout=0)
        
        min = _ifregular_squeeze_cast(min)
        max = _ifregular_squeeze_cast(max)

        shape = self._get_datashape()
        if np.shape(min) != shape or np.shape(max) != shape:
            raise Exception("shape mismatch, min and max must match %s" % str(shape))

        if len(shape) > 0:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (min, max, )
            _vectorized(shape, rmint_atomic, vnargs, args, ndaargs)
        else:
            rmint_atomic(self.varname, min, max)


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

        def create_ifunc(vn, symb):
            _eval("%s = %s();" % (vn, symb), nargout=0)
            parameternames = _eval('%s.Parameters;' % vn, nargout=1) # we basically just need the length
            parameternames = [p.split()[0] for p in parameternames]

        def create_model_array(vn, shape, symb):
            if len(shape) == 1:
                shape = (shape[0], 1)
            shape = str(list(shape)).replace("[","").replace("]","")
            _eval("%s = zeros(%s, %s);" % (vn, symb, shape), nargout=0)

        self.varname = '%s_%d' % (_get_ifunc_prefix(), id(self))

        datashape = _npify_shape(datashape)
        if datashape not in [None, tuple()]:
            create_model_array(self.varname, datashape, symbol)
            vnargs = (self.varname, )
            args = (symbol, )
            ndaargs = ()
            _vectorized(datashape, create_ifunc, vnargs, args, ndaargs)
        else:
            create_ifunc(self.varname, symbol)

    def get_repr(self):
        
        datashape = self._get_datashape()
        retdct = self._get_full_repr_dict()
        retdct['info'] = {'datashape' : datashape}
        
        if datashape in [None, tuple()]:
            vn = self.varname
            pkeys = _eval('%s.Parameters;' % vn, nargout=1)
            pvals = {}
            for key in pkeys:
                key0 = key.split(' ')[0] # it should always be key0
                val = _eval('%s.%s' % (vn, key0), nargout=1)
                while type(val) == list:
                    val = val[0]
                if type(val) != float:
                    pvals[key0] = None
                elif math.isnan(float(val)):
                    pvals[key0] = None
                else:
                    pvals[key0] = val
            retdct['userdata'] = pvals

        return retdct

    def set_user_data(self, json_obj):
        ''' 
        Apply guess values to parameters.
        
        However, this is currently disabled due to a ui issue
        (repeated incomplete set_data on the undo stach will produce error messages)
        '''
        #set_parvalues_atomic(self.varname, json_obj)

    def _get_datashape(self):
        ''' returns the naiive datashape (size) of the matlab object associated with self.varname '''
        s = np.array(_eval("size(%s)" % self.varname, nargout=1)[0]).astype(int).tolist() # NOTE: tolist() converts to native python int from np.int64
        s = _npify_shape(s)
        return s

    def guess(self, guess: dict, rank:int=0):
        ''' applies a guess to the parameters of this instance '''

        def set_parvalues_atomic(vn, dct):
            parameternames = _eval('%s.Parameters;' % vn)
            parameternames = [p.split(' ')[0] for p in parameternames]
            # this covers all cases of missing or superfluous names in dct
            if not set(parameternames) == set(dct.keys()):
                raise Exception("guess: parameter name mismatch")
            # make sure all values are defined properly
            if None in dct.values():
                raise Exception("guess: undefined parameter value")
            # pick out values in the correct order
            values = []
            for key in parameternames:
                values.append(dct[key])
            # because MATLAB arrays are not arrays of handles, we have to do the triangle trick
            _eval('tmp = %s;' % vn, nargout=0)
            _eval('tmp.ParameterValues = [%s];' % ' '.join( [str(float(v)) for v in values] ), nargout=0)
            _eval('%s = tmp;' % vn, nargout=0)
            _eval('clear tmp;', nargout=0)

        if rank<0:
            raise Exception("rank must be a positive integer")
        
        guess = _ifregular_squeeze_cast(guess, rank)
        if rank == 0:
            set_parvalues_atomic(self.varname, guess)
        else:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (guess, )
            shape = self._get_datashape()
            _vectorized(shape, set_parvalues_atomic, vnargs, args, ndaargs)

    def fixpars(self, parnames: list, rank:int=0):

        def fixpars_atomic(vn, fixpars):
            # this hack fixes cases where fixpars_atomic is vectorized, in which case numpy can reduce
            # fixpars from a list with one string element to a string
            if type(fixpars) in (np.str_, str):
                fixpars = [fixpars]
            allpars = _eval('%s.Parameters;' % vn, nargout=1)
            allpars = [p.split(' ')[0] for p in allpars]
            dontfix = [p for p in allpars if p not in fixpars]
            for p in fixpars:
                _eval("fix(%s, '%s');" % (vn, p), nargout=0)
            for p in dontfix:
                _eval("munlock(%s, '%s');" % (vn, p), nargout=0)

        if rank<0:
            raise Exception("rank must be a positive integer")

        parnames = _ifregular_squeeze_cast(parnames, rank)
        if rank == 0:
            fixpars_atomic(self.varname, parnames)
        else:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (parnames, )
            shape = self._get_datashape()
            _vectorized(shape, fixpars_atomic, vnargs, args, ndaargs)

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self.varname
        _eval(cmd)
    
def _ifregular_squeeze_cast(lst, rank=None):
    ''' returns squeezeed lst cast to np.array, if regular, optionally limited regular down to the rank'th index '''
    if type(lst) not in (list, np.array,):
        return lst
    if len(np.shape(lst))==1 and len(lst) == 1:
        return np.array(lst)
    reg = _is_regular_ndarray(lst, rank)
    if not reg:
        raise Exception("list not regular")
    
    # TODO: should lst be squeezed or not?
    #return np.squeeze(np.array(lst))
    return np.array(lst)

def _npify_shape(shape):
    ''' eliminates any 1's from shape, such values may be given by a user or from matlab '''
    if shape == None:
        return np.shape(shape)
    return tuple(s for s in shape if s>1)

def _is_regular_ndarray(lst, rank:int=None):
    '''
    Returns true if the input arbitrarily nested list is irregular, e.g. has sublists of varying length.
    
    lst: the input ndarray or python list
    rank: limits the depth to which regularity is checked to the rank'th index
    '''
    def _is_regular_rec(l):
        len0 = None
        for i in range(len(l)):
            nxt = l[i]
            if type(nxt) in (list, np.ndarray):
                if not len0:
                    len0 = len(nxt)
                _is_regular_rec(nxt)
                if len(nxt) != len0:
                    raise Exception("array not regular")
    def _is_regular_rec_ranked(l, rank):
        len0 = None
        for i in range(len(l)):
            nxt = l[i]
            if type(nxt) in (list, np.ndarray) and rank > 1:
                if not len0:
                    len0 = len(nxt)
                _is_regular_rec(nxt, rank-1)
                if len(nxt) != len0:
                    raise Exception("array not regular")
    try:
        if type(rank) == int and rank >= 1:
            _is_regular_rec_ranked(lst, rank)
        else:
            _is_regular_rec(lst)
        return True
    except:
        return False

def _vectorized(shape, atomic_func, vnargs, args, ndaargs):
    '''
    Hybrid vectorize python/matlab lists combining varnames and ndim numpy arrays
    using an "atomic" function which executes the ml command given its required input
    deterined by the user and matched in vnargs, args and ndaargs in that order.
    
    shape: iteration specification
    atomic_func: atomic function taking naiive arguments
    vnargs: varname args, the matlab-side vector variable names
    args: vector scalars, the same for all indices
    ndaargs: python-side ndarray args (must be numpy arrays)
    
    NOTE: Iteration is determined by the "shape" arg. The caller is responsible for 
    matching the shapes of all ndaargs, given that these may extend "shape", and
    are free to pass extended shape in case "atomic_func" takes a lits argument 
    (if it e.g. implements reduce-like functionality).
    '''
    it = np.ndindex(shape)
    for ndindex in it:
        indices = [i+1 for i in ndindex]
        indices = str(indices).replace("[","(").replace("]",")")
        
        symbols = tuple("%s%s" % (vn, indices) for vn in vnargs)
        constants = args
        elements = tuple(a.take(ndindex)[0] for a in ndaargs)
        atomic_func(*symbols, *constants, *elements)


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
    
    ds1 = idata._get_datashape()
    ds2 = ifunc._get_datashape()
    if ds1 != ds2:
        raise Exception("datashape mismatch: %s vs. %s", (str(ds1), str(ds2)))
    if ds1 != tuple() or ds2 != tuple():
        raise Exception("vectorized version not implemented")
    
    retobj = IData(None)
    
    _eval("%s = %s(%s);" % (retobj.varname, idata.varname, ifunc.varname), nargout=0)
    return retobj

def fit(idata: IData, ifunc: IFunc, optimizer:str="fminpowell") -> IFunc:
    logging.debug("fit: %s, %s" % (idata, ifunc))

    # TODO: alter the call to 'fits' in a way that respects the current ifunc par values as a guess

    def fit_atomic(vn_data, vn_func, vn_outfunc, optim):
        _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s), \'\', \'%s\')' % (vn_outfunc, vn_data, vn_func, optim), nargout=0)
        _eval('%s = o_%s.model' % (vn_outfunc, vn_outfunc), nargout=0)
        _eval('clear o_%s' % vn_outfunc, nargout=0)

    ds1 = idata._get_datashape()
    ds2 = ifunc._get_datashape()
    if ds1 != ds2:
        raise Exception("datashape mismatch: %s vs. %s" % (str(ds1), str(ds2)))
    if ds1 != tuple() or ds2 != tuple():
        raise Exception("vectorized version not implemented")
 
    datashape = ds1
    retobj = IFunc(datashape)
    if datashape not in (None, tuple(),):
        raise Exception("vectorized use of fit not supported")
    else:
        fit_atomic(idata.varname, ifunc.varname, retobj.varname, optimizer)
    return retobj

def combine(filenames:list, rank:int=0) -> IData:
    ''' a data reduce / merges which is vectorized explicitly for rank>0'''
    logging.debug("combine")

    def combine_atomic(vn, fns):
        if type(fns) not in (np.ndarray, list, ):
            raise Exception("combine: file names input must be an ndarray");
        for i in range(len(fns)):
            _eval("%s = combine(%s);" % (vn, " iData(\'" + "\'), iData(\'".join(fns) + "\') "), nargout=0)

    def create_idata_array(vn, shape):
        if len(shape) == 1:
            shape = (shape[0], 1)
        shape = str(list(shape)).replace("[","").replace("]","")
        _eval("%s = zeros(iData, %s);" % (vn, shape), nargout=0)

    filenames = _ifregular_squeeze_cast(filenames, rank)

    retobj = None
    if rank == 0:
        retobj = IData(url=None)
        combine_atomic(retobj.varname, filenames)
    elif rank > 0:
        shape = np.shape(filenames)[0:rank]
        retobj = IData(url=None)
        create_idata_array(retobj.varname, shape)
        
        vnargs = (retobj.varname, )
        args = ()
        ndaargs = (filenames, )
        _vectorized(shape, combine_atomic, vnargs, args, ndaargs)
    else:
        raise Exception("combine: rank must be in Z_0")
    
    return retobj


