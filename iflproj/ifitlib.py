'''
iFit-interfaced library used as a base for generating ifitlab node types.

#####

Classes:
- Any class, function or method can be is flagged as "non-public" by an underscore prefix in 
its name - e.g. _get_plot_1D - will be omitted during type generation.
- Any class can implement the static ObjReprJson.non_polymorphic_typename (annotated by @staticmethod)
whereby its constructor node will output that typename
- Inherit classes from ObjReprJson
- Implement get_repr and set_user_data to interact with low-level data.

Functions & methods:
- Any parameter with a default value will not give rise to a connectable anchor, but a configurable field on the
node.

Module level:
- A function "_load_middleware" may be implemented, and must return an object subclassed from enginterface.MiddeWare.
'''
from builtins import str
from importlib.abc import _register
__author__ = "Jakob Garde"

import enginterface
from iflproj.settings import IFIT_DIR

import scipy.misc
import io
import base64
import matlab.engine
import math
import re
import os
import logging
logging.basicConfig(level=logging.DEBUG)
import numpy as np
import collections
import uuid
import datetime
import threading

_eng = None
_cmdlog = None
def _eval(cmd, nargout=1, dontlog=False):
    global _loglock
    global _eng
    global _cmdlog
    with _loglock:
        if not _cmdlog:
            _cmdlog = logging.getLogger('cmds')
            hdlr = logging.FileHandler('logs/cmds.log')
            hdlr.level = logging.INFO
            hdlr.setFormatter(logging.Formatter('%(message)s'))
            _cmdlog.addHandler(hdlr) 

            _cmdlog.info("")
            _cmdlog.info("")
            _cmdlog.info("%%  starting ifit cmd log session at %s  %%" % '{0:%Y%m%d_%H%M%S}'.format(datetime.datetime.now()))
        if not _eng:
            _eng = matlab.engine.start_matlab(' -nodesktop -nosplash')
            _eng.eval("addpath(genpath('%s'))" % IFIT_DIR)
        if not dontlog:
            _cmdlog.info(cmd)
        return _eng.eval(cmd, nargout=nargout)

# since all ML variables should be created using these proxy methods, we can register all ML symbols easily
_all_exe_lock_symbols = set();
def _register_tmp_symb(symb):
    global _all_exe_lock_symbols
    _all_exe_lock_symbols.add(symb)
    return symb
def _get_ifunc_uuid():
    return _register_tmp_symb('ifunc_%s' % uuid.uuid4().hex)
def _get_idata_uuid():
    return _register_tmp_symb('idata_%s' % uuid.uuid4().hex)
def _get_anonymous_uuid():
    return _register_tmp_symb('_%s' % uuid.uuid4().hex)

# log lines are registered on-demand
_loglock = threading.Lock()
def _extract_loglines(varnames):
    ''' extracts lines with any string in varnames from logs/cmds.log, deleting these lines in the source '''
    source = 'logs/cmds.log'
    with _loglock:
        # work through the log, extracting lines appropriate for [varnames] to return, hereby reducing its size
        with open(source, 'r') as srcfile:
            regex_lst = [re.compile(vn) for vn in varnames] # compile the regex's of each varname, these are used for every line
            cmds_left = []
            cmds_right = []
            for line in srcfile:
                if True in [r.search(line)!=None for r in regex_lst]:
                    cmds_right.append(line)
                else:
                    cmds_left.append(line)

        # replace source with filtered "left" lines (without ruining the file pointer used by logging)
        with open(source, 'w') as srcfile:
            srcfile.write("".join(cmds_left))
            srcfile.close()

        # return the "right" lines
        return cmds_right

# middlware keeps session-management out of this module, although locks must be used instead, with a modest multi-user performance hit 
_hl_exe_lock = threading.Lock()
class _VarnameMiddleware(enginterface.MiddleWare):
    ''' implements registration and deregistration of varnames, clears matlab variables on deregister and exit '''
    def __init__(self):
        self.varnames = set()
        self.varnames_tmp = set()
    def totalwho(self):
        ''' returns all variables in the (global) matlab session '''
        return _eval("who;", nargout=1, dontlog=True)
    def register(self, obj):
        ''' remembers the varname for logging and session shutdown purposes '''
        if type(obj) in (IData, IFunc, ):
            self.varnames.add(obj.varname)
    def deregister(self, obj):
        ''' deregister must also matlab-delete for this operation to be general '''
        if type(obj) in (IData, IFunc, ) and obj.varname in self.varnames:
            self.varnames.remove(obj.varname)
            self.varnames_tmp.add(obj.varname)
            _eval("clear %s;" % obj.varname, nargout=0) # we need to log this clear, which represents a permanent departure for this object
    def load(self, filepath):
        _eval("load('%s');" % filepath, nargout=0, dontlog=True)
    def save(self, filepath):
        # filter possibly outdated varnames using who
        allvars = _eval("who;", nargout=1, dontlog=True)
        self.varnames = set([v for v in allvars if v in self.varnames])
        save_str = "'" + "', '".join(self.varnames) + "'"
        _eval("save('%s', %s);" % (filepath, save_str), nargout=0, dontlog=True)
    def clear(self):
        for vn in self.varnames:
            # some varnames may have been cleared previously, for ex. if their anchor was not on the graph
            try:
                # do not log varname clears, since symbols can be used again after a session load
                _eval("clear %s;" % vn, nargout=0, dontlog=True)
            except:
                pass
        self.varnames = set()
    def finalise(self):
        self.clear()
    def extract_loglines(self):
        return _extract_loglines(self.varnames | self.varnames_tmp)
    def get_logheader(self):
        text = "%%\n" + '%%  log generated on {0:%Y%m%d_%H%M%S}'.format(datetime.datetime.now()) + "\n%%\n%%  required:\n%%    addpath(genpath(YOUR_IFIT_LOCATION))\n%%\n%%  varnames:\n%%    " + "\n%%    ".join(self.varnames) + "\n%%\n"
        return text
    def execute_through_proxy(self, func):
        ''' executing in this way allows for limiting the use of the "high level execution lock" to this method only '''
        with _hl_exe_lock:
            ans = func()
            self.register(ans)

            # house cleaning
            global _all_exe_lock_symbols
            to_be_cleared = _all_exe_lock_symbols - self.varnames # set between used and known symbols
            self.varnames_tmp = self.varnames_tmp | to_be_cleared # remember what was cleared for log extraction later on
            for vn in to_be_cleared:
                # some tmp varnames may have already been cleared locally
                try:
                    _eval("clear %s;" % vn, nargout=0)
                except:
                    pass
            _all_exe_lock_symbols = set()
            return ans

def _load_middleware():
    return _VarnameMiddleware()


''' middleware dict specifying where node types are stored in a resultnig data structure '''
namecategories = collections.OrderedDict({
    'IData' : 'tools',
    'IData_1d' : 'tools',
    'IData_2d' : 'tools',
    'IData.mask' : 'tools',
    'IData.rebin' : 'tools',
    'IFunc' : 'tools',
    'IFunc.guess' : 'tools',
    'IFunc.fixpars' : 'tools',
    'fit' : 'tools',

    'Lin' : 'models',
    'Gauss' : 'models',
    'Lorentz' : 'models',
    'add_models' : 'models',
    'mult_models' : 'models',
    'separate' : 'models',

    'Combine_data' : 'operators',
    'log' : 'operators',
    'power': 'operators',
    'scale' : 'operators',
    'add' : 'operators',
    'from_model' : 'operators',
    'subtract_data' : 'operators',
    'divide_data' : 'operators',
    'catenate' : 'operators',
    'transpose' : 'operators',
})


''' IData section '''


class IData(enginterface.ObjReprJson):
    ''' Creates an IData object using data file located at url. '''
    def __init__(self, url, datashape=None):
        logging.debug("IData.__init__('%s')" % url)
        self.varname = _get_idata_uuid()

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
            _eval("%s = iData('%s');" % (vn, url), nargout=0)
            if os.path.splitext(url)[1] in ('.png', '.jpg'):
                # Check if this is a color or monochrome image
                ndims = int(_eval('ndims(%s);' % vn))
                if ndims>2:
                    # handles the case of color channels in common image files (collapse to grayscale to load as 2D data)
                    _eval("%s = iData(rgb2gray(%s.Signal));" % (vn, vn), nargout=0)

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

    def __del__(self):
        _eval("clear %s;" % self.varname, nargout=0)

    def _get_datashape(self):
        try:
            _eval("%s.Signal;" % self.varname, nargout=0)
        except:
            s = np.array(_eval("size(%s);" % self.varname, nargout=1)[0]).astype(int).tolist() # NOTE: tolist() converts to native python int from np.int64
            return _npify_shape(s)
        return tuple()

    def get_repr(self):
        retdct = self._get_full_repr_dict()
        # detect if we are a list or a plan iData object
        datashape = self._get_datashape()
        outdct = {}

        if datashape in (None, tuple(),):
            pltdct, infdct = _get_iData_repr(self.varname)
            outdct = None
        else:
            def get_repr_atomic(symb):
                pltdct, infdct = _get_iData_repr(symb)
                return pltdct, infdct
            def get_element(idx, e):
                return e[idx]

            vnargs = (self.varname, )
            args = ()
            ndaargs = ()
            ndout = np.empty(datashape, object)
            _vectcollect(datashape, get_repr_atomic, vnargs, args, ndaargs, ndout)

            # this will extract the first element (of the ndout ndarray elements) into a similarly shaped ndarray
            vnargs = ()
            args = (0, )
            ndaargs = (ndout, )
            plts = np.empty(datashape, object)
            _vectcollect(datashape, get_element, vnargs, args, ndaargs, plts)

            pltdct = plts.tolist()
            outdct = None
            infdct = {'datashape' : datashape, 'ndims' : None} # ndims refers to (individual) data dimensionality

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct
        retdct['output'] = outdct

        return retdct

    def mask(self, min: float, max: float):
        ''' Masks data of the specified interval. '''
        logging.debug("IData.mask")
        ''' 
        NOTE: a (minmax_lst) signatured version of mask (previously rmint) would require a "rank" or "shape" indexing 
        depth parameter (same as combine).
        '''
        def rmint_atomic(vn, start, end):
            _eval("%s = xlim(%s, [%g %g], 'exclude');" % (vn, vn, start, end), nargout=0)

        min = _ifregular_squeeze_cast(min)
        max = _ifregular_squeeze_cast(max)

        shape = self._get_datashape()
        if np.shape(min) != shape or np.shape(max) != shape:
            raise Exception("shape mismatch, shape of min and max must match %s" % str(shape))

        if len(shape) > 0:
            vnargs = (self.varname, )
            args = ()
            ndaargs = (min, max, )
            _vectorized(shape, rmint_atomic, vnargs, args, ndaargs)
        else:
            rmint_atomic(self.varname, min, max)

    def rebin(self, nbins: int, axis: int=1):
        ''' Rebins using interpolate. '''
        logging.debug("IData.rebin")

        def rebin_atomic(vn, ax, nb):
            
            # b = interp(a, new_axis) where new_axis=linspace(min(getaxis(a,axis)),max(getaxis(a,axis)),newbins) for axis=1, 2, ...
            _eval("%s = interp(%s, linspace(min(getaxis(%s, %d)), max(getaxis(%s, %d)), %d));" % (vn, vn, vn, ax, vn, ax, nb), nargout=0)

        nbins = _ifregular_squeeze_cast(nbins)

        shape = self._get_datashape()
        if np.shape(nbins) != shape:
            raise Exception("shape mismatch, shape of nbins must match %s" % str(shape))
        if (type(axis) != int) and (axis > 0):
            raise Exception("axis must be a positive integer")

        if len(shape) > 0:
            vnargs = (self.varname, )
            args = (axis, )
            ndaargs = (nbins, )
            _vectorized(shape, rebin_atomic, vnargs, args, ndaargs)
        else:
            rebin_atomic(self.varname, axis, nbins)


def _get_iData_repr(idata_symb):
    
    def trysquash(vals):
        if len(vals)==1:
            try:
                vals = vals[0]
            except:
                pass
        return vals
    
    ndims = int(_eval('ndims(%s);' % idata_symb))
    axes_names = _eval('%s.Axes;' % idata_symb, nargout=1) # NOTE: len(axes_names) == ndims
    if not ndims == len(axes_names):
        # handles the case of non-existing axis names, i.e. from loading an image file
        for i in range(ndims):
            _eval('%s = %s.setaxis(%d,%s{%d});' % (idata_symb,idata_symb,i+1,idata_symb,i+1), nargout=0)
        axes_names = _eval('%s.Axes;' % idata_symb, nargout=1) # Ensure we use the auto-generated axis names
    axesvals = []
    pltdct = {}

    # Get axis labels
    xlabel = _eval('xlabel(%s);' % idata_symb, nargout=1)
    ylabel = _eval('ylabel(%s);' % idata_symb, nargout=1)
    
    # fallback labels
    if xlabel == "":
        xlabel = "x"
    if ylabel == "Data Signal":
        ylabel = "y"
    
    # get signal
    if ndims == 0:
        ' the trivial case, no data is present '
        pltdct = None
    elif ndims == 1:

        xvals = _eval('%s.%s;' % (idata_symb, axes_names[0]))
        xvals = trysquash(xvals)
        xvals = np.reshape(xvals, (1, len(xvals)))[0]

        signal = np.array(_eval('%s.Signal./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float)
        signal = trysquash(signal)
        signal = np.reshape(signal, (1, len(signal)))[0]

        try:
            error = np.array(_eval('%s.Error./%s.Monitor;' % (idata_symb, idata_symb), nargout=1)).astype(np.float)
            error = trysquash(error)
            error = np.reshape(error, (1, len(error)))[0]
        except:
            error = np.sqrt(signal)

        # remove all NaN, Inf and -Inf entries
        include_set = np.logical_not(np.isnan(np.subtract(signal, error)))
        signal = signal[include_set].tolist()
        xvals = xvals[include_set].tolist()
        error = error[include_set].tolist()

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
            ivals = list(_eval('%s.%s;' % (idata_symb, axes_names[i]) )[0])
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
        # Real number from 0 to len(cm)-1 [0:63]
        xp = (len(cm)-1) * x
        # Simply round off and return
        idx = np.int(np.round(xp))
        return cm[idx]
        
    
    dims = np.shape(signal)
    
    # the colour maps
    # Default, converted from recent Matlab default colormap
    cm = np.array([[62, 38, 168, 255], [64, 42, 180, 255], [66, 46, 192, 255], [68, 50, 203, 255], [69, 55, 213, 255], [70, 60, 222, 255], [71, 65, 229, 255], [71, 71, 235, 255], [72, 77, 240, 255], [72, 82, 244, 255], [71, 88, 248, 255], [70, 94, 251, 255], [69, 99, 253, 255], [66, 105, 254, 255], [62, 111, 255, 255], [56, 117, 254, 255], [50, 124, 252, 255], [47, 129, 250, 255], [46, 135, 247, 255], [45, 140, 243, 255], [43, 145, 239, 255], [39, 151, 235, 255], [37, 155, 232, 255], [35, 160, 229, 255], [32, 165, 227, 255], [28, 169, 223, 255], [24, 173, 219, 255], [18, 177, 214, 255], [ 8, 181, 208, 255], [ 1, 184, 202, 255], [ 2, 186, 195, 255], [11, 189, 189, 255], [25, 191, 182, 255], [36, 193, 174, 255], [44, 196, 167, 255], [49, 198, 159, 255], [55, 200, 151, 255], [63, 202, 142, 255], [74, 203, 132, 255], [87, 204, 122, 255], [100, 205, 111, 255], [114, 205, 100, 255], [129, 204, 89, 255], [143, 203, 78, 255], [157, 201, 67, 255], [171, 199, 57, 255], [185, 196, 49, 255], [197, 194, 42, 255], [209, 191, 39, 255], [220, 189, 41, 255], [230, 187, 45, 255], [240, 186, 54, 255], [248, 186, 61, 255], [254, 190, 60, 255], [254, 195, 56, 255], [254, 201, 52, 255], [252, 207, 48, 255], [250, 214, 45, 255], [247, 220, 42, 255], [245, 227, 39, 255], [245, 233, 36, 255], [246, 239, 32, 255], [247, 245, 27, 255], [249, 251, 21, 255]], dtype=np.ubyte)
    # hsv-oriented colormap
    #cm = np.array([[255, 0, 0, 255], [255,  24, 0, 255], [255,  48, 0, 255], [255,  72, 0, 255], [255,  96, 0, 255], [255, 120, 0, 255], [255, 143, 0, 255], [255, 167, 0, 255], [255, 191, 0, 255], [255, 215, 0, 255], [255, 239, 0, 255], [247, 255, 0, 255], [223, 255, 0, 255], [199, 255, 0, 255], [175, 255, 0, 255], [151, 255, 0, 255], [128, 255, 0, 255], [104, 255, 0, 255], [ 80, 255, 0, 255], [ 56, 255, 0, 255], [ 32, 255, 0, 255], [  8, 255, 0, 255], [  0, 255,  16, 255], [  0, 255,  40, 255], [  0, 255,  64, 255], [  0, 255,  88, 255], [  0, 255, 112, 255], [  0, 255, 135, 255], [  0, 255, 159, 255], [  0, 255, 183, 255], [  0, 255, 207, 255], [  0, 255, 231, 255], [  0, 255, 255, 255], [  0, 231, 255, 255], [  0, 207, 255, 255], [  0, 183, 255, 255], [  0, 159, 255, 255], [  0, 135, 255, 255], [  0, 112, 255, 255], [  0,  88, 255, 255], [  0,  64, 255, 255], [  0,  40, 255, 255], [  0,  16, 255, 255], [  8, 0, 255, 255], [ 32, 0, 255, 255], [ 56, 0, 255, 255], [ 80, 0, 255, 255], [104, 0, 255, 255], [128, 0, 255, 255], [151, 0, 255, 255], [175, 0, 255, 255], [199, 0, 255, 255], [223, 0, 255, 255], [247, 0, 255, 255], [255, 0, 239, 255], [255, 0, 215, 255], [255, 0, 191, 255], [255, 0, 167, 255], [255, 0, 143, 255], [255, 0, 120, 255], [255, 0,  96, 255], [255, 0,  72, 255], [255, 0,  48, 255], [255, 0,  24, 255]], dtype=np.ubyte)
    
    # create the 2d data as a png given our colormap
    img = np.zeros((dims[0], dims[1], 4))
    maxval = np.max(signal)
    minval = np.min(signal)
    for i in range(dims[0]):
        for j in range(dims[1]):
            img[i,j,:] = lookup(cm, (signal[i][j]-minval)/(maxval-minval))
    # encode png as base64 string
    image = scipy.misc.toimage(np.flipud(img))
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
    image_log= scipy.misc.toimage(np.flipud(img_log))
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


''' IFunc section '''


class IFunc(enginterface.ObjReprJson):
    ''' Creates an IFunc object, a flexible fitting model. Use iFit syntax to input a model specification in the "symbol" argument. '''
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
                                     "sqw_linquad", "sqw_acoustopt",
                                     "log", "square")
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

        def create_model_array(vn, shape):
            if len(shape) == 1:
                shape = (shape[0], 1)
            shape = str(list(shape)).replace("[","").replace("]","")
            _eval("%s = zeros(iFunc, %s);" % (vn, shape), nargout=0)

        if symbol == None or symbol == "":
            symbol = "iFunc"

        self.varname = _get_ifunc_uuid()
        self._plotaxes = None
        self._plotdims = None
        self.symbol = symbol

        datashape = _npify_shape(datashape)
        if datashape not in [None, tuple()]:
            create_model_array(self.varname, datashape)
            if symbol != "iFunc":
                vnargs = (self.varname, )
                args = (symbol, )
                ndaargs = ()
                _vectorized(datashape, create_ifunc, vnargs, args, ndaargs)
        else:
            create_ifunc(self.varname, symbol)

    def __del__(self):
        _eval("clear %s;" % self.varname, nargout=0)

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
        pltdct = None
        usrdct = {}
        outdct = None
        
        if datashape in [None, tuple()]:
            pltdct, infdct, usrdct = _get_iFunc_repr(self.varname, self._plotaxes, self._plotdims)
            outdct = usrdct
        else:
            def get_repr_atomic(symb, pltax=None, pltdims=None):
                pltdct, infdct, userdct = _get_iFunc_repr(symb, pltax, pltdims)
                return pltdct, infdct, userdct
            def get_element(idx, e):
                return e[idx]
            
            vnargs = (self.varname, )
            args = ()
            ndaargs = ()
            if (self._plotaxes is not None) and (self._plotdims is not None):
                ndaargs = (self._plotaxes, self._plotdims, )
            ndout = np.empty(datashape, object)
            _vectcollect(datashape, get_repr_atomic, vnargs, args, ndaargs, ndout)

            vnargs = ()
            args = (0, )
            ndaargs = (ndout, )
            plts = np.empty(datashape, object)
            _vectcollect(datashape, get_element, vnargs, args, ndaargs, plts)

            args = (2, )
            usrs = np.empty(datashape, object)
            _vectcollect(datashape, get_element, vnargs, args, ndaargs, usrs)

            outdct = usrs.tolist()
            usrdct = outdct
            pltdct = plts.tolist()
            infdct = {'datashape' : datashape, 'ndims' : None}

        retdct['plotdata'] = pltdct
        retdct['info'] = infdct
        retdct['userdata'] = usrdct
        retdct['output'] = outdct
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
        s = np.array(_eval("size(%s);" % self.varname, nargout=1)[0]).astype(int).tolist() # NOTE: tolist() converts to native python int from np.int64
        s = _npify_shape(s)
        return s

    def guess(self, guess: dict):
        ''' Applies values to parameters by means of dictionary keys-value pairs. All values must be set simultaneously. '''

        def set_parvalues_atomic(vn, vn_noidx, dct):
            parameternames = _eval('%s.Parameters;' % vn)
            parameternames = [p.split(' ')[0] for p in parameternames]

            # avoid unknown parameternames
            if False in [True if p in parameternames else False for p in dct.keys()]:
                raise Exception("guess: parameter name mismatch")

            # fill out missing keys
            for key in parameternames:
                if key not in dct:
                    dct[key] = None

            # replace None with the ML-readable "NaN"
            for key in dct:
                if dct[key] == None:
                    dct[key] = "NaN"

            # extract values in the correct order
            values = []
            for key in parameternames:
                values.append(dct[key])

            # because MATLAB arrays are not arrays of handles, we have to do the triangle trick
            try:
                # we put the varname in the tmp variable to elliminate any threading issues arising from a common tmp var
                _eval('tmp_%s = %s;' % (vn_noidx, vn), nargout=0)
                _eval('tmp_%s.ParameterValues = [%s];' % (vn_noidx, ' '.join( [str(float(v)) for v in values] )), nargout=0)
                _eval('%s = tmp_%s;' % (vn, vn_noidx), nargout=0)
            finally:
                _eval('clear tmp_%s;' % vn_noidx, nargout=0)

        shape = self._get_datashape()
        rank = len(shape)

        guess = _ifregular_squeeze_cast(guess, rank)
        if rank == 0:
            set_parvalues_atomic(self.varname, self.varname, guess)
        else:
            vnargs = (self.varname, )
            args = (self.varname, )
            ndaargs = (guess, )
            _vectorized(shape, set_parvalues_atomic, vnargs, args, ndaargs)

    def fixpars(self, parnames: list):
        ''' Fixes parameters with the specified names. Fixed parameters will not be varied during fit optimizations. '''

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
        val = _eval('%s.%s;' % (varname, key0), nargout=1)
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
            fvals = _eval("feval(%s, [%s], linspace(%s, %s, 100));" % (varname, parvalstr, xmin, xmax), nargout=1)
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
            raise Exception("plotdims==2 has not been implemented")
        else:
            raise Exception("plotdims must be set")

    return pltdct, infdct, userdct


'''
Vectorization.
'''


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

def _vectcollect(shape, atomic_func, vnargs, args, ndaargs, collectarg):
    '''
    This _vectcollect does the same as the above _vectorized, but it also assigns
    the return value of called function to the appropriate entry of the n-dimensional
    collectarg. This container must be initialized correctly, using e.g.
    np.empty(datashape, object) or similar.
    '''
    it = np.ndindex(shape)
    for ndindex in it:
        indices = [i+1 for i in ndindex] # convert to matlab indexing
        indices = str(indices).replace("[","(").replace("]",")")
        
        symbols = tuple("%s%s" % (vn, indices) for vn in vnargs)
        constants = args
        elements = tuple(eval("a%s" % str(list(ndindex))) for a in ndaargs) # this is not pretty, but it works
        
        value = atomic_func(*symbols, *constants, *elements)
        exec("collectarg%s = value" % str(list(ndindex)))

def _vectcollect_general(shape, atomic_func, vnargs, args, ndaargs, collectargs):
    '''
    Adds an extra layer for plural return values of atomic_func, as one explicit outer
    dimension/args tuple.
    This can be handy for elliminating the need to unpack values later on.
    '''
    it = np.ndindex(shape)
    for ndindex in it:
        indices = [i+1 for i in ndindex] # convert to matlab indexing
        indices = str(indices).replace("[","(").replace("]",")")
        
        symbols = tuple("%s%s" % (vn, indices) for vn in vnargs)
        constants = args
        elements = tuple(eval("a%s" % str(list(ndindex))) for a in ndaargs) # this is not pretty, but it works
        
        value = atomic_func(*symbols, *constants, *elements)

        
        if type(value) != tuple:
            exec("collectargs%s = value" % str(list(ndindex)))
        else:
            if len(collectargs) == len(value):
                for i in range(len(value)):
                    val = value[i]
                    exec("collectargs[i]%s = val" % str(list(ndindex)))
            else:
                raise Exception("_vectorcollect_general: Mismatching atomic_func return tuple length and collectargs length.")


'''
Functionality implementations.
'''


'''
IFunc based.
'''


def add_models(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    ''' Outputs the sum of two IFunc model objects, preserving configuration state. '''
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


def mult_models(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    ''' Outputs the multiplication of two IFunc model objects '''
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


def fit(idata: IData, ifunc: IFunc, optimizer:str="fminpowell") -> IFunc:
    ''' Outputs the fitted model of an IFunc model to an IData object. '''
    logging.debug("fit: %s, %s" % (idata, ifunc))

    # TODO: alter the call to 'fits' in a way that respects the current ifunc par values as a guess

    def fit_atomic(vn_data, vn_func, vn_outfunc, optim):
        try:
            _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s), \'\', \'%s\');' % (vn_outfunc, vn_data, vn_func, optim), nargout=0)
            _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s), \'\', \'%s\');' % (vn_outfunc, vn_data, vn_func, optim), nargout=0)
            _eval('[p, c, m, o_%s] = fits(%s, copyobj(%s), \'\', \'%s\');' % (vn_outfunc, vn_data, vn_func, optim), nargout=0)
            _eval('%s = o_%s.model;' % (vn_outfunc, vn_outfunc), nargout=0)
        except:
            _eval('%s = copyobj(%s);' % (vn_outfunc, vn_func), nargout=0)
        finally:
            _eval('clear o_%s;' % vn_outfunc, nargout=0)

    def get_axislims_atomic(vn_data):
        ''' returns (axislims, ndims) where axislims is a tuple of (xmin, xmax) or (xmin, xmax, ymin, ymax) '''
        plotdata = _get_iData_repr(vn_data)[0]
        if plotdata:
            ndims = plotdata["ndims"]
            if ndims == 1:
                x = plotdata["x"]
                return (np.min(x), np.max(x)), 1
            elif ndims == 2:
                return (plotdata['xmin'], plotdata['xmax'], plotdata['ymin'], plotdata['ymax']), 2

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
        
        axeslims = np.empty(shape, object)
        axesdims = np.empty(shape, object)
        vnargs = (idata.varname, )
        args = ()
        collectargs = (axeslims, axesdims, )
        _vectcollect_general(shape, get_axislims_atomic, vnargs, args, ndaargs, collectargs)
        retobj._set_plotaxes(axeslims, axesdims)
    else:
        fit_atomic(idata.varname, ifunc.varname, retobj.varname, optimizer)
        
        lims, ndims = get_axislims_atomic(idata.varname)
        retobj._set_plotaxes(lims, ndims)
    return retobj


'''
Constructors (capitalized)
'''


def Gauss(datashape:list=None) -> IFunc:
    ''' Creates a Gauss IFunc model. '''
    return IFunc(datashape, 'gauss')

def Lorentz(datashape:list=None) -> IFunc:
    ''' Creates a Lorentz IFunc model. '''
    return IFunc(datashape, 'lorz')

def Lin(datashape:list=None) -> IFunc:
    ''' Creates a Linear IFunc model. '''
    return IFunc(datashape, 'strline')


def IData_1d(axis: list, signal: list, error: list) -> IData:
    ''' Creates an (x, y) IData object from two lists. '''
    logging.debug("IData_1D")

    def set_x_y_atomic(vn_out, ax, sig, err):
        _eval("setaxis(%s, 1, %s);" % (vn_out, str(ax)), nargout=0)
        _eval("%s.Signal = %s;" % (vn_out, str(sig)), nargout=0)
        _eval("%s.Error = %s;" % (vn_out, str(err)), nargout=0)

    ds1 = np.shape(axis)
    ds2 = np.shape(signal)
    ds3 = np.shape(error)
    if ds1 != ds2 or ds1 != ds3:
        raise Exception("datashape mismatch, %s vs. %s" % (str(ds1), str(ds2)))
    if type(axis) != list or type(signal) != list or type(error) != list:
        raise Exception("axis and signal must be lists")

    shape = ds1
    retobj = None
    if len(shape) <= 1:
        retobj = _create_empty_idata()
        set_x_y_atomic(retobj.varname, axis, signal, error)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, )
        args = ()
        ndaargs = (axis, signal, error, )
        _vectorized(shape, set_x_y_atomic, vnargs, args, ndaargs)

    return retobj


def IData_2d(axes: list, signal: list) -> IData:
    ''' Creates an two dimensional IData object from axes and signal args. The dimensionality of axes must be one higher than that of signal. '''
    logging.debug("IData_2d")

    raise Exception("not yet implemented")
    # TODO: impl.: make sure len(ds1) == len(ds2)+1 and use ds2 as the vectorization shape


def Combine_data(filenames:list) -> IData:
    ''' Combines and outputs multiple data files into a single IData object. '''
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


def _create_empty_idata():
    retvar = IData(url=None)
    _eval("%s = iData;" % retvar.varname, nargout=0)
    return retvar


def _create_empty_idata_array(shape):
    retvar = IData(url=None)
    if len(shape) == 1:
        shape = (shape[0], 1)
    shape_str = str(list(shape)).replace("[","").replace("]","")
    _eval("%s = zeros(iData, %s);" % (retvar.varname, shape_str), nargout=0)

    return retvar


'''
IFunc based
'''


def separate(fitfunc: IFunc, typefunc: IFunc, pidx=-1) -> IFunc:
    ''' Extracts parameter values and axis information from fitfunc given the parameters in typefunc. Returns a new IFunc object with that parameter configuration.'''

    '''
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
            _eval('tmp_%s = %s;' % (vn_outf, vn_outf), nargout=0)
            for key in wanted:
                _eval('tmp_%s.%s = %s;' % (vn_outf, key, str(wanted[key])), nargout=0)
            _eval('%s = tmp_%s;' % (vn_outf, vn_outf), nargout=0)
        finally:
            _eval('clear tmp_%s;' % vn_outf, nargout=0)

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


def from_model(data: IData, model: IFunc) -> IData:
    ''' Defines a dataset operator from an iFunc model. '''
    raise Exception("To be implemented.")


'''
IData based.
'''


def log(data: IData, axis: int=0) -> IData:
    ''' A log dataset operator. "axis": 0 is signal, 1 first axis, etc. '''
    retobj = _create_empty_idata()
    vn_dest = retobj.varname
    vn_source = data.varname
    if axis==0:
        _eval("%s = log(%s);" % (vn_dest, vn_source), nargout=0)
    else:
        _eval("%s = setaxis(%s, %d, log(getaxis(%s, %d)));" % (vn_dest, vn_source, axis, vn_source, axis), nargout=0)
    return retobj


def power(data: IData, axis: int=0, power: int=2) -> IData:
    ''' A power dataset operator (square, cube, ...). "axis": 0 is signal, 1 first axis, etc. '''
    def power_atomic(vn_dest, vn_source, axis, power):
        if axis==0:
            _eval("%s = power(%s,%d);" % (vn_dest, vn_source, power), nargout=0)
        else:
            _eval("%s = setaxis(%s, %d, power(getaxis(%s, %d), %d));" % (vn_dest, vn_source, axis, vn_source, axis, power), nargout=0)

    shape = data._get_datashape()
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        power_atomic(retobj.varname, data.varname, axis, power)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, data.varname, )
        args = (axis, power, )
        ndaargs = ()
        _vectorized(shape, power_atomic, vnargs, args, ndaargs)

    return retobj


def transpose(data: IData) -> IData:
    ''' Transpose dataset. '''
    def transpose_atomic(vn_dest, vn_source):
        _eval("%s = %s';" % (vn_dest, vn_source), nargout=0)

    shape = data._get_datashape()
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        transpose_atomic(retobj.varname, data.varname)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, data.varname, )
        args = ()
        ndaargs = ()
        _vectorized(shape, transpose_atomic, vnargs, args, ndaargs)

    return retobj


def catenate(data: IData) -> IData:
    ''' Concatenate dataset (k x R^n -> R^n+1). '''
    def catenate_atomic(vn_dest, vn_source):
        _eval("%s = cat(0,%s)';" % (vn_dest, vn_source), nargout=0)

    retobj = _create_empty_idata()
    catenate_atomic(retobj.varname, data.varname)

    return retobj


def subtract_data(sample: IData, background: IData) -> IData:
    ''' Subtract a calibration set, e.g. background from data. '''
    logging.debug("subtract")

    def subtract_atomic(vn_out, vn_1, vn_2):
        _eval("%s = %s - %s;" % (vn_out, vn_1, vn_2), nargout=0)

    ds1 = sample._get_datashape()
    ds2 = background._get_datashape()
    if ds1 != ds2:
        raise Exception("datashape mismatch, %s vs. %s" % (str(ds1), str(ds2)))

    shape = ds1
    retobj = None
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        subtract_atomic(retobj.varname, sample.varname, background.varname)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, sample.varname, background.varname, )
        args = ()
        ndaargs = ()
        _vectorized(shape, subtract_atomic, vnargs, args, ndaargs)

    return retobj


def divide_data(sample: IData, background: IData) -> IData:
    ''' Divide a calibration set, e.g. for normalization. '''
    logging.debug("divide")

    def divide_atomic(vn_out, vn_1, vn_2):
        _eval("%s = %s ./ %s;" % (vn_out, vn_1, vn_2), nargout=0)

    ds1 = sample._get_datashape()
    ds2 = background._get_datashape()
    if ds1 != ds2:
        raise Exception("datashape mismatch, %s vs. %s" % (str(ds1), str(ds2)))

    shape = ds1
    retobj = None
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        divide_atomic(retobj.varname, sample.varname, background.varname)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, sample.varname, background.varname, )
        args = ()
        ndaargs = ()
        _vectorized(shape, divide_atomic, vnargs, args, ndaargs)

    return retobj


def scale(dataset: IData, axis: int=0, scale: float=1.0) -> IData:
    ''' Scale dataset by real number. '''
    logging.debug("Scale")

    def scale_atomic(vn_dest, vn_source, axis, scale):
        if axis==0:
            _eval("%s = %s * %g;" % (vn_dest, vn_source, scale), nargout=0)
        else:
            _eval("%s = setaxis(%s, %d, getaxis(%s, %d) * %g);" % (vn_dest, vn_source, axis, vn_source, axis, scale), nargout=0)

    shape = dataset._get_datashape()
    retobj = None
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        scale_atomic(retobj.varname, dataset.varname, axis, scale)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, dataset.varname, )
        args = (axis, scale, )
        ndaargs = ()
        _vectorized(shape, scale_atomic, vnargs, args, ndaargs)

    return retobj


def add(dataset: IData, axis: int=0, scalar: float=0) -> IData:
    ''' Add real number to dataset. '''
    logging.debug("Add")

    def add_atomic(vn_dest, vn_source, axis, scalar):
        if axis==0:
            _eval("%s = %s + %g;" % (vn_dest, vn_source, scalar), nargout=0)
        else:
            _eval("%s = setaxis(%s, %d, getaxis(%s, %d) + %g);" % (vn_dest, vn_source, axis, vn_source, axis, scalar), nargout=0)

    shape = dataset._get_datashape()
    retobj = None
    if shape in (None, tuple(),):
        retobj = _create_empty_idata()
        add_atomic(retobj.varname, dataset.varname, axis, scalar)
    else:
        retobj = _create_empty_idata_array(shape)
        vnargs = (retobj.varname, dataset.varname, )
        args = (axis, scalar, )
        ndaargs = ()
        _vectorized(shape, add_atomic, vnargs, args, ndaargs)

    return retobj

