'''
iFit-interfaced library used as a base for generating ifitlab node types.

Notes on node type generation:
1) any class, function or method can be is flagged as "non-public" by an underscore prefix in 
its name - e.g. _get_plot_1D - will be omitted.
2) any class can implement the static ObjReprJson.non_polymorphic_typename (annotated by @staticmethod)
whereby its constructor node will output that type name

Module loader / node generator features:
1) inherit all classes from ObjReprJson
2) implement get_repr and set_user_data to interact with low-level data. Extend or use _get_full_repr_dict only.
3) implement non_polymorphic_typename (annotated with @staticmethod) if you want to overload 
the node type of the resulting constructor node
4) any parameter with a default value will not give rise to a node anchor, but rathe a configurable value on the
actual node in the gui. Use this for function configuration options that are better suited for this minor or 
secondary presence
5) A function "_load_middleware" may be implemented. It must return an object subclassed from engintf.MiddeWare.
'''
__author__ = "Jakob Garde"

import engintf
from iflproj.settings import IFIT_DIR

import scipy.misc
import io
import base64
import matlab.engine
import math
import re
import logging
logging.basicConfig(level=logging.DEBUG)
import numpy as np
import functools

_eng = None
_cmdlog = None
def _eval(cmd, nargout=1):
    global _eng
    global _cmdlog
    if not _cmdlog:
        _cmdlog = logging.getLogger('cmds')
        hdlr = logging.FileHandler('cmds.m')
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

class _VarnameMiddleware(engintf.MiddleWare):
    ''' handles registration of varnames for clearing when finalize() is called '''
    def __init__(self):
        self.varnames = []
    def register(self, obj):
        if type(obj) in (IData, IFunc, ):
            self.varnames.append(obj.varname)
    def finalize(self):
        for vn in self.varnames:
            _eval("clear %s;" % vn, nargout=0)
def _load_middleware():
    return _VarnameMiddleware()

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
        if datashape in (tuple(), None,):
            datashape = np.shape(url)
        elif str(np.shape(url)) != str(datashape):
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
            pltdct, infdct = _get_iData_repr(self.varname)
        else:
            pltdct = None
            infdct = {'datashape' : datashape, 'ndims' : None} # ndims refers to (individual) data dimensionality

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct

        return retdct

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

def _get_iData_repr(idata_symb):
    ndims = int(_eval('ndims(%s)' % idata_symb))
    axes_names = _eval('%s.Axes' % idata_symb, nargout=1) # NOTE: len(axes_names) == ndims
    if not ndims == len(axes_names):
        # TODO: handle this case in which ifit has not found any axes in the data
        raise Exception("could not find axes")
    axesvals = []
    pltdct = {}

    # Get axis labels
    xlabel = _eval('xlabel(%s)' % idata_symb, nargout=1)
    ylabel = _eval('ylabel(%s)' % idata_symb, nargout=1)
    
    # get signal
    if ndims == 0:
        ' the trivial case, no data is present '
        pltdct = None
    elif ndims == 1:
        xvals = _eval('%s.%s;' % (idata_symb, axes_names[0]))
        if len(xvals)==1:
            try:
                xvals = xvals[0]
            except:
                pass
        xvals = np.reshape(xvals, (1, len(xvals)))[0].tolist()

        signal = np.array(_eval('%s.Signal./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float)
        signal = np.reshape(signal, (1, len(signal)))[0].tolist()
        
        try:
            error = np.array(_eval('%s.Error./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float)
            error = np.reshape(error, (1, len(error)))[0].tolist()
        except:
            error = np.sqrt(signal).tolist()

        # get rid of nan
        cnt = 0
        while len(signal) > cnt:
            if math.isnan(signal[cnt]):
                try:
                    del xvals[cnt]
                    del signal[cnt]
                    del error[cnt]
                except Exception as e:
                    print(2)
            else:
                cnt = cnt + 1
        
        pltdct = _get_plot_1D(xvals, signal, error, xlabel=xlabel, ylabel=ylabel, title=idata_symb, style_as_data=True)
    elif ndims == 2:
        xvals = list(_eval('%s.%s;' % (idata_symb, axes_names[0]) )[0])
        yvals = list(_eval('%s.%s;' % (idata_symb, axes_names[1]) )[0])
        axesvals.append(xvals)
        axesvals.append(yvals)

        signal = np.array(_eval('%s.Signal./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float).tolist()
        error = np.array(_eval('%s.Error./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float).tolist()
        
        pltdct = _get_plot_2D(axesvals, signal, error, xlabel=xlabel, ylabel=ylabel, title=idata_symb)
    else:
        for i in range(ndims):
            ivals = list(_eval('%s.%s' % (idata_symb, axes_names[i]) )[0])
            axesvals.append(ivals)
        signal = list(_eval('%s.Signal;' % idata_symb)[0])
        error = list(_eval('%s.Error;' % idata_symb)[0])
    
    infdct = {'datashape' : None}
    infdct['ndims'] = "%d" % ndims
    return pltdct, infdct

def _get_plot_1D(axisvals, signal, yerr, xlabel, ylabel, title, style_as_data=False):
    ''' returns the dict required by the svg 1d plotting function '''
    params = {}
    p = params
    p['w'] = 326
    p['h'] = 220
    p['x'] = axisvals
    p['y'] = signal
    p['yerr'] = yerr
    p['xlabel'] = xlabel
    p['ylabel'] = ylabel
    p['title'] = title
    p['ndims'] = 1
    p['style_as_data'] = style_as_data # should the style "data" (as opposed to "model") be used when plotting?
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
    
    # the colour map
    cm = np.array([[0,0,143,255], [0,0,159,255], [0,0,175,255], [0,0,191,255], [0,0,207,255], [0,0,223,255], [0,0,239,255], [0,0,255,255], [0,16,255,255], [0,32,255,255], [0,48,255,255], [0,64,255,255], [0,80,255,255], [0,96,255,255], [0,112,255,255], [0,128,255,255], [0,143,255,255], [0,159,255,255], [0,175,255,255], [0,191,255,255], [0,207,255,255], [0,223,255,255], [0,239,255,255], [0,255,255,255], [16,255,239,255], [32,255,223,255], [48,55,207,255], [64,255,191,255], [80,255,175,255], [96,255,159,255], [112,255,143,255], [128,255,128,255], [143,255,112,255], [159,255,96,255], [175,255,80,255], [191,255,64,255], [207,255,48,255], [223,255,32,255], [239,255,16,255], [255,255,0,255], [255,239,0,255], [255,223,0,255], [255,207,0,255], [255,191,0,255], [255,175,0,255], [255,159,0,255], [255,143,0,255], [255,128,0,255], [255, 112,0, 255], [255,96,0, 255], [255,80,0, 255], [255,64,0, 255], [255,48,0, 255], [255,32,0, 255], [255,16,0, 255], [255,0,0, 255], [239,0,0, 255], [223,0,0, 255], [207,0,0, 255], [191,0,0, 255], [175,0,0, 255], [159,0,0, 255], [143,0,0, 255], [128,0,0, 255]], dtype=np.ubyte)
    
    # create the 2d data as a png given our colormap
    img = np.zeros((dims[0], dims[1], 4))
    maxval = np.max(signal)
    for i in range(dims[0]):
        for j in range(dims[1]):
            img[i,j,:] = lookup(cm, signal[i][j]/maxval)
    # encode png as base64 string
    image = scipy.misc.toimage(img)
    output = io.BytesIO()
    image.save(output, format="png")
    encoded_2d_data = str(base64.b64encode(output.getvalue())).lstrip('b').strip("\'")
    output.close()
    
    # create log data as another png
    img_log = np.zeros((dims[0], dims[1], 4))
    minval = 1e19
    for row in signal:
        for val in row:
            if val > 0 and val < minval:
                minval = val
    minval_log = np.log10(minval/10)
    signal_log = np.ma.log10(signal).filled(minval_log) # masked array filling in zeros (zero must be mask false...)
    maxval_log = np.max(signal_log)
    for i in range(dims[0]):
        for j in range(dims[1]):
            try:
                img_log[i,j,:] = lookup(cm, (signal_log[i][j] - minval_log)/(maxval_log - minval_log))
            except Exception as e:
                print(e)
    # encode png as base64 string
    image_log= scipy.misc.toimage(img_log)
    output = io.BytesIO()
    image_log.save(output, format="png")
    encoded_2d_data_log = str(base64.b64encode(output.getvalue())).lstrip('b').strip("\'")
    output.close()
    
    # color bar
    tmpimg = np.zeros((256, 1, 4))
    for i in range(256):
        color = lookup(cm, i/255)
        tmpimg[255-i, 0] = color
    cb_img = scipy.misc.toimage(tmpimg)
    output = io.BytesIO()
    cb_img.save(output, format='png')
    encoded_cb = str(base64.b64encode(output.getvalue())).lstrip('b').strip("\'")
    output.close()
    
    # log color bar
    tmpimg = np.zeros((256, 1, 4))
    for i in range(256):
        color = lookup(cm, i/255)
        tmpimg[255-i, 0] = color
    cb_img_log = scipy.misc.toimage(tmpimg)
    output = io.BytesIO()
    cb_img_log.save(output, format='png')
    encoded_cb_log = str(base64.b64encode(output.getvalue())).lstrip('b').strip("\'")
    output.close()

    x = axisvals[0]
    y = axisvals[1]
    xmin = np.min(x)
    xmax = np.max(x)
    ymin = np.min(y)
    ymax = np.max(y)

    cb_min = np.min(signal)
    cb_max = np.max(signal)
    cb_min_log = np.min(signal_log)
    cb_max_log = np.max(signal_log)

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

    p['img2dDataLog'] = encoded_2d_data_log
    p['imgColorbarLog'] = encoded_cb_log

    p['cbMin'] = cb_min
    p['cbMax'] = cb_max
    
    p['cbMinLog'] = cb_min_log
    p['cbMaxLog'] = cb_max_log

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
            def is_known_ifit_builtin(modelname):
                ''' see: http://ifit.mccode.org/Models.html '''
                return modelname in ("allometric", "bigauss", "bilorz", "bose", "dho", "dirac", "doseresp", "expon", 
                                     "expstretched", "gauss", "green", "heaviside", "langevin", "laplace", "lognormal", 
                                     "lorz", "ngauss", "nlorz", "pareto", "poisson", "pseudovoigt", "quadline", "sigmoid",
                                     "sine", "sinedamp", "strline", "triangl", "tophat", "twoexp", "voigt", "gauss2d", 
                                     "lorz2d", "plane2d", "pseudovoigt2d", "quad2d", "gaussnd", "sf_hard_spheres", "rietveld",
                                     "sqw_sine3d", "sqw_spinw", "sqw_vaks", "sqw_cubic_monoatomic", "sqw_phonons",
                                     "sqw_linquad", "sqw_acoustopt")
            def canbe_ifit_expression(expr):
                ''' p(1)... notation, see ifit docs '''
                m = re.match('[0-9a-zA-Z\.\-\+\*\/\(\)\^]+', expr)
                if m and len(m.group()) == len(expr):
                    return True
            
            if is_known_ifit_builtin(symb):
                _eval("%s = %s();" % (vn, symb), nargout=0)
            elif canbe_ifit_expression(symb):
                _eval("%s = iFunc('%s');" % (vn, symb), nargout=0)
            else:
                raise Exception('unrecognized ifit expression: "%s"' % symb)
            
            parameternames = _eval('%s.Parameters;' % vn, nargout=1) # we basically just need the length
            parameternames = [p.split()[0] for p in parameternames]

        def create_model_array(vn, shape, symb):
            if len(shape) == 1:
                shape = (shape[0], 1)
            shape = str(list(shape)).replace("[","").replace("]","")
            _eval("%s = zeros(%s, %s);" % (vn, symb, shape), nargout=0)

        if symbol == None or symbol == "":
            symbol = "iFunc"

        self.varname = '%s_%d' % (_get_ifunc_prefix(), id(self))
        self._plotaxes = None
        self._plotdims = None
        self.symbol = symbol

        datashape = _npify_shape(datashape)
        if datashape not in [None, tuple()]:
            create_model_array(self.varname, datashape, symbol)
            vnargs = (self.varname, )
            args = (symbol, )
            ndaargs = ()
            _vectorized(datashape, create_ifunc, vnargs, args, ndaargs)
        else:
            create_ifunc(self.varname, symbol)

    def _clear_plotaxes(self):
        self._plotaxes = None
        self._plotdims = None

    def _set_plotaxes(self, axeslims, ndims):
        self._plotaxes = axeslims
        self._plotdims = ndims

    def get_repr(self):
        ''' mostly delegated to the offline function _get_iFunc_repr '''
        datashape = self._get_datashape()
        retdct = self._get_full_repr_dict()
        usrdct = {}
        
        if datashape in [None, tuple()]:
            pltdct, infdct, usrdct = _get_iFunc_repr(self.varname, self._plotaxes, self._plotdims)
        else:
            pltdct = None
            infdct = {'datashape' : datashape, 'ndims' : None}

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct
        retdct['userdata'] = usrdct
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

    def guess(self, guess: dict):
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
            try:
                _eval('tmp = %s;' % vn, nargout=0)
                _eval('tmp.ParameterValues = [%s];' % ' '.join( [str(float(v)) for v in values] ), nargout=0)
                _eval('%s = tmp;' % vn, nargout=0)
            finally:
                _eval('clear tmp;', nargout=0)

        shape = self._get_datashape()
        rank = len(shape)

        guess = _ifregular_squeeze_cast(guess, rank)
        if rank == 0:
            set_parvalues_atomic(self.varname, guess)
        else:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (guess, )
            _vectorized(shape, set_parvalues_atomic, vnargs, args, ndaargs)

    def fixpars(self, parnames: list):

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

        shape = self._get_datashape()
        rank = len(shape)

        parnames = _ifregular_squeeze_cast(parnames, rank)
        if rank == 0:
            fixpars_atomic(self.varname, parnames)
        else:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (parnames, )
            _vectorized(shape, fixpars_atomic, vnargs, args, ndaargs)

def _get_iFunc_repr(varname, plotaxes, plotdims, datashape = None):
    ''' returns an ifunc representation, and can even be used to extract a plot from a vactorized instance '''
    # get parameter names and fvals
    pkeys = _eval('%s.Parameters;' % varname, nargout=1)
    pvals = {}
    vals = []
    for key in pkeys:
        key0 = key.split(' ')[0] # it should always be key0
        val = _eval('%s.%s' % (varname, key0), nargout=1)
        while type(val) == list:
            val = val[0]
        if type(val) != float:
            pvals[key0] = None
        elif math.isnan(float(val)):
            pvals[key0] = None
        else:
            pvals[key0] = val
            vals.append(val)
    userdct = pvals
    pltdct = None
    infdct = {'datashape' : datashape}

    # if we have plotaxes != None, get function evaluation fvals on those
    if plotaxes and len(pkeys) == len(vals):
        if plotdims == 1:
            xmin = plotaxes[0]
            xmax = plotaxes[1]
            parvalstr = ' '.join([str(v) for v in vals])
            fvals = _eval("feval(%s, [%s], linspace(%s, %s, 100))" % (varname, parvalstr, xmin, xmax), nargout=1)
            fvals = np.array(fvals[0]).tolist()
            xvals = np.linspace(xmin, xmax, 100).tolist()
            yerr = np.zeros(100).tolist()
            #xlabel = _eval("xlabel(%s)" % varname, nargout=1)
            #ylabel = _eval("ylabel(%s)" % varname, nargout=1)
            xlabel = "x"
            ylabel = "y"
            pltdct = _get_plot_1D(axisvals=xvals, signal=fvals, yerr=yerr, xlabel=xlabel, ylabel=ylabel, title="title")
            infdct = {'datashape' : datashape, 'ndims' : "%d" % 1}

        elif plotdims == 2:
            raise Exception("IFunc._plotdims==2 has not been implemented")

    return pltdct, infdct, userdct

def _lowest_level_irr_squeezecast(lst):
    # coule be e.g. a string
    if type(lst) not in (list, np.array,):
        return lst
    # list with single non-list element
    if len(np.shape(lst))==1 and len(lst) == 1:
        return np.array(lst)
    depth = _max_depth(lst)
    # if depth==1 then lst must be regular (depth==0 was ruled out above)
    if depth > 1:
        if not _is_regular_ndarray(lst, depth-1):
            raise Exception("list is not regular down to maxdepth-1")
    # TODO: should lst be squeezed or not?
    #return np.squeeze(np.array(lst))
    return np.array(lst), depth-1

def _ifregular_squeeze_cast(lst, rank=None):
    ''' returns squeezeed lst cast to np.array, if regular, optionally limited regular down to the rank'th index '''
    # coule be e.g. a string
    if type(lst) not in (list, np.array,):
        return lst
    # list with single non-list element
    if len(np.shape(lst))==1 and len(lst) == 1:
        return np.array(lst)
    isreg = _is_regular_ndarray(lst, rank)
    if not isreg:
        raise Exception("list not regular")
    
    # TODO: should lst be squeezed or not?
    #return np.squeeze(np.array(lst))
    return np.array(lst)

def _npify_shape(shape):
    ''' eliminates any 1's from shape, such values may be given by a user or from matlab '''
    if shape == None:
        return np.shape(shape)
    return tuple(s for s in shape if s>1)

def _max_depth(lst):
    def _depth_rec(l, d, m):
        if m[0] < d:
            m[0] = d
        for i in range(len(l)):
            nxt = l[i]
            if type(nxt) in (list, np.ndarray):
                _depth_rec(nxt, d+1, m)
    if type(lst) not in (list, np.array,):
        return 0
    maxdepth = [0]
    _depth_rec(lst, 1, maxdepth)
    return maxdepth[0]

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
                _is_regular_rec_ranked(nxt, rank-1)
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
        indices = [i+1 for i in ndindex] # convert to matlab indexing
        indices = str(indices).replace("[","(").replace("]",")")
        
        symbols = tuple("%s%s" % (vn, indices) for vn in vnargs)
        constants = args
        elements = tuple(eval("a%s" % str(list(ndindex))) for a in ndaargs) # this is not pretty, but it works
        
        atomic_func(*symbols, *constants, *elements)


class PlotIter(engintf.ObjReprJson):
    ''' extract plotdata at index in vectorized idata '''
    def __init__(self, data:IData, pltiter):
        '''
        IData object "data" must be vectorized. PltIter instance "pltiter" can be None
        or a PltIter instance derived from the same data/IData object.
        '''
        self.shape = data._get_datashape()
        if self.shape in (tuple(), None, ):
            raise Exception("PltIter requires iterable IData instance")
        
        # determine indices - init or derive from input
        it = np.ndindex(self.shape)
        midx = None
        if pltiter:
            cycle = False
            while True:
                try:
                    midx = it.next()
                    if midx == pltiter.nxt_idx:
                        break
                except StopIteration:
                    if cycle:
                        raise Exception("invalid index")
                    it = np.ndindex(self.shape)
                    self.nxt_idx = it.next()
                    cycle = True
        else:
            midx = it.next()

        self.midx = midx;
        self.idx = np.ravel_multi_index(self.midx, self.shape)
        try:
            self.nxt_idx = it.next()
        except StopIteration:
            it = np.ndindex(self.shape)
            self.nxt_idx = it.next()

        # determine idata symbol
        indices = [i+1 for i in self.midx] # convert to matlab indexing
        indices = str(indices).replace("[","(").replace("]",")")
        self.indices = indices
        self.symb = "%s%s" % (data.varname, indices)
        
    def get_repr(self):
        retdct = self._get_full_repr_dict()
        pltdct, infdct = _get_iData_repr(self.symb)

        oned_size = functools.reduce(lambda d1,d2: d1*d2, self.shape)

        retdct['info'] = infdct
        retdct['info']['wtitle'] = "%d of %d" % (self.idx+1, oned_size)
        retdct['userdata'] = {
                'midx' : self.midx,
                'nxt_idx' : self.nxt_idx
            }
        retdct['plotdata'] = pltdct

        return retdct

    def set_user_data(self, json_obj):
        idx = json_obj.get("midx", None)
        if tuple(idx) != self.midx:
            raise Exception("PltIter: changing midx not possible, please use nxt_idx.")
        nxt_idx = json_obj.get("nxt_idx", None)
        if nxt_idx:
            self.nxt_idx = tuple(nxt_idx)

class FitIter(engintf.ObjReprJson):
    ''' extract plotdata at index in vectorized ifunc '''
    def __init__(self, fit:IFunc, fititer):
        self.shape = fit._get_datashape()
        if self.shape in (tuple(), None, ):
            raise Exception("PltIter requires iterable IFunc instance")
        
        # determine indices - init or derive from input
        it = np.ndindex(self.shape)
        midx = None
        if fititer:
            cycle = False
            while True:
                try:
                    midx = it.next()
                    if midx == fititer.nxt_idx:
                        break
                except StopIteration:
                    if cycle:
                        raise Exception("invalid index")
                    it = np.ndindex(self.shape)
                    self.nxt_idx = it.next()
                    cycle = True
        else:
            midx = it.next()

        self.midx = midx;
        self.idx = np.ravel_multi_index(self.midx, self.shape)
        try:
            self.nxt_idx = it.next()
        except StopIteration:
            it = np.ndindex(self.shape)
            self.nxt_idx = it.next()

        # determine idata symbol
        indices = [i+1 for i in self.midx] # convert to matlab indexing
        indices = str(indices).replace("[","(").replace("]",")")
        self.indices = indices
        
        varname = fit.varname + str(indices).replace("[","(").replace("]",")")
        
        pltdct, infdct, userdct = _get_iFunc_repr(varname, fit._plotaxes[self.idx], fit._plotdims, self.shape)
        self.plotdata = pltdct
        self.info = infdct
        
    def get_repr(self):
        retdct = self._get_full_repr_dict()
        
        oned_size = functools.reduce(lambda d1,d2: d1*d2, self.shape)

        retdct['info'] = self.info
        retdct['info']['wtitle'] = "%d of %d" % (self.idx+1, oned_size)
        retdct['userdata'] = {
                'midx' : self.midx,
                'nxt_idx' : self.nxt_idx
            }
        retdct['plotdata'] = self.plotdata

        return retdct

    def set_user_data(self, json_obj):
        idx = json_obj.get("midx", None)
        if tuple(idx) != self.midx:
            raise Exception("PltIter: changing midx not possible, please use nxt_idx.")
        nxt_idx = json_obj.get("nxt_idx", None)
        if nxt_idx:
            self.nxt_idx = tuple(nxt_idx)

'''
constructor functions for various models, substitutes for class constructors
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
    ''' returns the ifunc-addition of two IFunc objects '''
    # check datashape
    shape = ifunc_a._get_datashape()
    shape2 = ifunc_b._get_datashape()
    if shape != shape2:
        raise Exception("datashape mismatch: %s vs. %s" % (str(shape), str(shape2)))
    
    def add_atomic(vn1, vn2, vn_sum):
        _eval('%s = %s + %s;' % (vn_sum, vn1, vn2), nargout=0)
    
    retobj = IFunc(shape)
    if shape not in (None, tuple(),):
        vnargs = (ifunc_a.varname, ifunc_b.varname, retobj.varname, )
        args = ()
        ndaargs = ()
        _vectorized(shape, add_atomic, vnargs, args, ndaargs)
    else:
        add_atomic(ifunc_a.varname, ifunc_b.varname, retobj.varname)
    return retobj

def mult(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    ''' multiplies '''
    # check datashape
    shape = ifunc_a._get_datashape()
    shape2 = ifunc_b._get_datashape()
    if shape != shape2:
        raise Exception("datashape mismatch: %s vs. %s" % (str(shape), str(shape2)))
    
    def mult_atomic(vn1, vn2, vn_sum):
        _eval('%s = %s * %s;' % (vn_sum, vn1, vn2), nargout=0)
    
    retobj = IFunc(shape)
    if shape not in (None, tuple(),):
        vnargs = (ifunc_a.varname, ifunc_b.varname, retobj.varname, )
        args = ()
        ndaargs = ()
        _vectorized(shape, mult_atomic, vnargs, args, ndaargs)
    else:
        mult_atomic(ifunc_a.varname, ifunc_b.varname, retobj.varname)
    return retobj

'''
def trapz(ifunc: IFunc) -> IFunc:
    logging.debug("trapz: %s" % ifunc)
    vn_old = ifunc.varname
    obj = IFunc()
    vn_new = obj.varname
    _eval('%s = trapz(%s)' % (vn_new, vn_old))
    return obj
'''

'''
functions (also called "methods" in the ifit documentation
'''

def fit(idata: IData, ifunc: IFunc, optimizer:str="fminpowell") -> IFunc:
    ''' fits ifunc to idata and returns a fitted IFunc object, with plot information matching the axes of idata '''
    logging.debug("fit: %s, %s" % (idata, ifunc))

    # TODO: alter the call to 'fits' in a way that respects the current ifunc par values as a guess

    def fit_atomic(vn_data, vn_func, vn_outfunc, optim):
        try:
            _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s), \'\', \'%s\');' % (vn_outfunc, vn_data, vn_func, optim), nargout=0)
            _eval('%s = o_%s.model;' % (vn_outfunc, vn_outfunc), nargout=0)
        finally:
            _eval('clear o_%s;' % vn_outfunc, nargout=0)

    def get_axislims_atomic(vn_data, acclst=[]):
        ''' returns (axislims, ndims) where axislims is a tuple of (xmin, xmax) or (xmin, xmax, ymin, ymax) '''
        plotdata = _get_iData_repr(vn_data)[0]
        if plotdata:
            ndims = plotdata["ndims"]
            if ndims == 1:
                x = plotdata["x"]
                acclst.append((np.min(x), np.max(x), 1, ))
                return acclst[-1], 1
                #return (np.min(x), np.max(x)), 1
            elif ndims == 2:
                acclst.append((plotdata['xmin'], plotdata['xmax'], plotdata['ymin'], plotdata['ymax'], 2, ))
                return acclst[-1], 2
                #return (plotdata['xmin'], plotdata['xmax'], plotdata['ymin'], plotdata['ymax']), 2

    ds1 = idata._get_datashape()
    ds2 = ifunc._get_datashape()
    if ds1 != ds2:
        raise Exception("datashape mismatch: %s vs. %s" % (str(ds1), str(ds2)))

    shape = ds1
    retobj = IFunc(shape)
    if shape not in (None, tuple(),):
        vnargs = (idata.varname, ifunc.varname, retobj.varname, )
        args = (optimizer, )
        ndaargs = ()
        _vectorized(shape, fit_atomic, vnargs, args, ndaargs)
        
        axeslims = []
        vnargs = (idata.varname, )
        args = (axeslims, )
        _vectorized(shape, get_axislims_atomic, vnargs, args, ndaargs)
        retobj._set_plotaxes(axeslims, axeslims[0][2])
    else:
        fit_atomic(idata.varname, ifunc.varname, retobj.varname, optimizer)
        # flag retobj to produce plotdata with the current idata axes
        lims, ndims = get_axislims_atomic(idata.varname)
        retobj._set_plotaxes(lims, ndims)
    return retobj

def combine(filenames:list) -> IData:
    ''' a data reduce / merge handled by iFit'''
    logging.debug("combine")

    def combine_atomic(vn, fns):
        if type(fns) not in (np.ndarray, list, ):
            raise Exception("combine: file names input must be an ndarray");
        _eval("%s = combine(%s);" % (vn, " iData(\'" + "\'), iData(\'".join(fns) + "\') "), nargout=0)

    def create_idata_array(vn, shape):
        if len(shape) == 1:
            shape = (shape[0], 1)
        shape = str(list(shape)).replace("[","").replace("]","")
        _eval("%s = zeros(iData, %s);" % (vn, shape), nargout=0)

    filenames, rank = _lowest_level_irr_squeezecast(filenames)
    
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

def separate(fitfunc: IFunc, typefunc: IFunc, pidx=-1) -> IFunc:
    '''
    Extracts parameter values and axis information from fitfunc, given the parameters in typefunc, 
    returning a new IFunc object of that configuration.
    
    fitfunc:    object to extract parameter values and axes from
    typefunc:   object whose parameter names and type is used to extract information from 
                fitfunc, in generating separated output
    pidx:       If fitfunc has more matcheds for some parameters in 
                typefunc, an index is required to indicate which ones to copy
    '''
    
    def separate_atomic(vn_fitf, vn_outf, typef, idx):
        none, none, userdct = _get_iFunc_repr(vn_fitf, plotaxes=None, plotdims=None)
        none, none, wanted = _get_iFunc_repr(typef.varname, plotaxes=None, plotdims=None)

        # get the values
        if idx<=0:
            for key in wanted:
                try:
                    wanted[key] = userdct[key]
                except:
                    raise Exception("paraeter %s not found" % key)
        elif idx>0:
            for key in wanted:
                try:
                    key_idx = key + "_%d"%idx
                    wanted[key] = userdct[key_idx]
                except:
                    raise Exception("paraeter '%s' not found" % key_idx)
        
        # set values on the output function
        # (triangle trick enables indexing of vn_fitf using MATLAB, see IFunc.guess ...)
        try:
            _eval('tmp = %s;' % vn_outf, nargout=0)
            for key in wanted:
                _eval('tmp.%s = %s;' % (key, str(wanted[key])), nargout=0)
            _eval('%s = tmp;' % vn_outf, nargout=0)
        finally:
            _eval('clear tmp;', nargout=0)

    shape = fitfunc._get_datashape()
    if typefunc._get_datashape() not in (None, tuple(),):
        raise Exception("'typefunc' is used as a singular iFunc type indicator, and must have no shape")

    retobj = IFunc(shape, symbol=typefunc.symbol)
    if shape not in (None, tuple(),):
        vnargs = (fitfunc.varname, retobj.varname)
        args = (typefunc, pidx)
        ndaargs = ()
        _vectorized(shape, separate_atomic, vnargs, args, ndaargs)
    else:
        separate_atomic(fitfunc.varname, retobj.varname, typefunc, pidx)

    # handle IFunc axis lims inheritane
    retobj._set_plotaxes(fitfunc._plotaxes, fitfunc._plotdims)
    return retobj

