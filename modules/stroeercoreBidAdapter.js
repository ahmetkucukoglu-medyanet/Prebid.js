const bidmanager = require('../src/bidmanager');
const bidfactory = require('../src/bidfactory');
const utils = require('../src/utils');
const ajax = require('../src/ajax').ajax;
const url = require('../src/url');

module.exports = function (win = window) {
  const defaultHost = 'dsh.adscale.de';
  const defaultPath = '/dsh';
  const defaultPort = '';
  const bidderCode = 'stroeerCore';

  const validBidRequest = bid => bid.params && utils.isStr(bid.params.sid);

  const isMainPageAccessible = () => getMostAccessibleTopWindow() === win.top;

  const getPageReferer = () => getMostAccessibleTopWindow().document.referrer || undefined;

  const isSecureWindow = () => win.location.protocol === 'https:';

  function buildUrl({host: hostname = defaultHost, port = defaultPort, securePort, path: pathname = defaultPath}) {
    const secure = isSecureWindow();

    if (securePort && secure) {
      port = securePort;
    }

    return `${url.format({protocol: secure ? 'https' : 'http', hostname, port, pathname})}`;
  }

  function getMostAccessibleTopWindow() {
    let res = win;

    try {
      while (win.top !== res && res.parent.location.href.length) {
        res = res.parent;
      }
    }
    catch (ignore) {}

    return res;
  }

  function elementInView(elementId) {
    const visibleInWindow = (el, win) => {
      const rect = el.getBoundingClientRect();
      const inView = (rect.top + rect.height >= 0) && (rect.top <= win.innerHeight);

      if (win !== win.parent) {
        return inView && visibleInWindow(win.frameElement, win.parent);
      }

      return inView;
    };

    try {
      return visibleInWindow(win.document.getElementById(elementId), win);
    }
    catch (e) {
      // old browser, element not found, cross-origin etc.
    }
    return undefined;
  }

  function ajaxResponseFn(validBidRequestById) {
    return function(rawResponse) {
      let response;

      try {
        response = JSON.parse(rawResponse);
      }
      catch (e) {
        response = {bids: []};
        utils.logError('unable to parse bid response', 'ERROR', e);
      }

      response.bids.forEach(bidResponse => {
        const bidRequest = validBidRequestById[bidResponse.bidId];

        if (bidRequest) {
          const bidObject = Object.assign(bidfactory.createBid(1, bidRequest), {
            bidderCode,
            cpm: bidResponse.cpm,
            width: bidResponse.width,
            height: bidResponse.height,
            ad: bidResponse.ad
          });
          bidmanager.addBidResponse(bidRequest.placementCode, bidObject);
        }
      });

      const unfulfilledBidRequests = Object.keys(validBidRequestById)
        .filter(id => response.bids.find(bid => bid.bidId === id) === undefined)
        .map(id => validBidRequestById[id]);

      unfulfilledBidRequests.forEach(bidRequest => {
        bidmanager.addBidResponse(bidRequest.placementCode, Object.assign(bidfactory.createBid(2, bidRequest), {bidderCode}));
      });
    };
  }

  return {
    callBids: function (params) {
      const requestBody = {
        id: params.bidderRequestId,
        bids: [],
        ref: getPageReferer(),
        ssl: isSecureWindow(),
        mpa: isMainPageAccessible(),
        timeout: params.timeout - (Date.now() - params.auctionStart)
      };

      const validBidRequestById = {};

      params.bids.forEach(bidRequest => {
        if (validBidRequest(bidRequest)) {
          requestBody.bids.push({
            bid: bidRequest.bidId,
            sid: bidRequest.params.sid,
            siz: bidRequest.sizes,
            viz: elementInView(bidRequest.placementCode)
          });
          validBidRequestById[bidRequest.bidId] = bidRequest;
        }
        else {
          bidmanager.addBidResponse(bidRequest.placementCode, Object.assign(bidfactory.createBid(2, bidRequest), {bidderCode}));
        }
      });

      if (requestBody.bids.length > 0) {
        ajax(buildUrl(params.bids[0].params), ajaxResponseFn(validBidRequestById), JSON.stringify(requestBody), {
          withCredentials: true,
          contentType: 'text/plain'
        });
      }
    }
  };
};
