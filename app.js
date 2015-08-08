var app = angular.module('gainSight', ['highcharts-ng']);
app.config(['$httpProvider', function ($httpProvider) {
    var interceptor = ['$q', '$cacheFactory', '$timeout', '$rootScope', 'loadingBar', function ($q, $cacheFactory, $timeout, $rootScope, loadingBar) {
        /**
         * The reqsTotal = total number of requests made
         * reqsCompleted = The number of requests completed (either successfully or not)
         * latencyThreshold = The amount of time spent fetching before showing the loading bar
         * startTimeout = $timeout handle for latencyThreshold
         */
        var reqsTotal = 0, reqsCompleted = 0, latencyThreshold = loadingBar.latencyThreshold, startTimeout;

        /**
         * calls loadingBar.complete() which removes the
         * loading bar from the DOM.
         */
        function setComplete() {
            $timeout.cancel(startTimeout);
            loadingBar.complete();
            reqsCompleted = 0;
            reqsTotal = 0;
        }

        /**
         * Determine if the response has already been cached
         * @param  {Object}  config the config option from the request
         * @return {Boolean} return true if cached, otherwise false
         */
        function isCached(config) {
            var cache, defaultCache = $cacheFactory.get('$http'), defaults = $httpProvider.defaults;
            // Choose the proper cache source. Borrowed from angular: $http service
            if ((config.cache || defaults.cache) && config.cache !== false &&
                (config.method === 'GET' || config.method === 'JSONP')) {
                cache = angular.isObject(config.cache) ? config.cache
                    : angular.isObject(defaults.cache) ? defaults.cache
                    : defaultCache;
            }
            var cached = cache !== undefined ?
                cache.get(config.url) !== undefined : false;
            if (config.cached !== undefined && cached !== config.cached) {
                return config.cached;
            }
            config.cached = cached;
            return cached;
        }

        return {
            'request': function (config) {
                // Check to make sure this request hasn't already been cached and that
                // the requester didn't explicitly ask us to ignore this request:
                if (!config.ignoreLoadingBar && !isCached(config)) {
                    $rootScope.$broadcast('loadingBar:loading', {url: config.url});
                    if (reqsTotal === 0) {
                        startTimeout = $timeout(function () {
                            loadingBar.start();
                        }, latencyThreshold);
                    }
                    reqsTotal++;
                    loadingBar.set(reqsCompleted / reqsTotal);
                }
                return config;
            },
            'response': function (response) {
                if (!response.config.ignoreLoadingBar && !isCached(response.config)) {
                    reqsCompleted++;
                    $rootScope.$broadcast('loadingBar:loaded', {url: response.config.url});
                    if (reqsCompleted >= reqsTotal) {
                        setComplete();
                    } else {
                        loadingBar.set(reqsCompleted / reqsTotal);
                    }
                }
                return response;
            },
            'responseError': function (rejection) {
                if (!rejection.config.ignoreLoadingBar && !isCached(rejection.config)) {
                    reqsCompleted++;
                    $rootScope.$broadcast('loadingBar:loaded', {url: rejection.config.url});
                    if (reqsCompleted >= reqsTotal) {
                        setComplete();
                    } else {
                        loadingBar.set(reqsCompleted / reqsTotal);
                    }
                }
                return $q.reject(rejection);
            }
        };
    }];
    $httpProvider.interceptors.push(interceptor);
}]);
app.provider('loadingBar', function () {
    this.includeBar = true;
    this.latencyThreshold = 100;
    this.startSize = 0.02;
    this.parentSelector = 'body';
    this.loadingBarTemplate = '<div id="loading-bar"><div class="bar"><div class="peg"></div></div></div>';
    this.$get = ['$injector', '$document', '$timeout', '$rootScope', function ($injector, $document, $timeout, $rootScope) {
        var $animate,
            $parentSelector = this.parentSelector,
            loadingBarContainer = angular.element(this.loadingBarTemplate),
            loadingBar = loadingBarContainer.find('div').eq(0),
            incTimeout,
            completeTimeout,
            started = false,
            status = 0,
            includeBar = this.includeBar,
            startSize = this.startSize;

        /**
         * Inserts the loading bar element into the dom, and sets it to 2%
         */
        function _start() {
            if (!$animate) {
                $animate = $injector.get('$animate');
            }
            var $parent = $document.find($parentSelector).eq(0);
            $timeout.cancel(completeTimeout);
            // do not continually broadcast the started event:
            if (started) {
                return;
            }
            $rootScope.$broadcast('loadingBar:started');
            started = true;
            if (includeBar) {
                $animate.enter(loadingBarContainer, $parent);
            }
            _set(startSize);
        }

        /**
         * Set the loading bar's width to a certain percent.
         *
         * @param n any value between 0 and 1
         */
        function _set(n) {
            if (!started) {
                return;
            }
            var pct = (n * 100) + '%';
            loadingBar.css('width', pct);
            status = n;
            // increment loadingBar to give the illusion that there is always
            // progress but make sure to cancel the previous timeouts so we don't
            // have multiple incs running at the same time.
            $timeout.cancel(incTimeout);
            incTimeout = $timeout(function () {
                _inc();
            }, 250);
        }

        /**
         * Increments the loading bar by a random amount
         * but slows down as it progresses
         */
        function _inc() {
            if (_status() >= 1) {
                return;
            }
            var rnd = 0;
            // TODO: do this mathematically instead of through conditions
            var stat = _status();
            if (stat >= 0 && stat < 0.25) {
                // Start out between 3 - 6% increments
                rnd = (Math.random() * (5 - 3 + 1) + 3) / 100;
            } else if (stat >= 0.25 && stat < 0.65) {
                // increment between 0 - 3%
                rnd = (Math.random() * 3) / 100;
            } else if (stat >= 0.65 && stat < 0.9) {
                // increment between 0 - 2%
                rnd = (Math.random() * 2) / 100;
            } else if (stat >= 0.9 && stat < 0.99) {
                // finally, increment it .5 %
                rnd = 0.005;
            } else {
                // after 99%, don't increment:
                rnd = 0;
            }
            var pct = _status() + rnd;
            _set(pct);
        }

        function _status() {
            return status;
        }

        function _completeAnimation() {
            status = 0;
            started = false;
        }

        function _complete() {
            if (!$animate) {
                $animate = $injector.get('$animate');
            }
            $rootScope.$broadcast('loadingBar:completed');
            _set(1);
            $timeout.cancel(completeTimeout);
            // Attempt to aggregate any start/complete calls within 500ms:
            completeTimeout = $timeout(function () {
                var promise = $animate.leave(loadingBarContainer, _completeAnimation);
                if (promise && promise.then) {
                    promise.then(_completeAnimation);
                }
            }, 500);
        }

        return {
            start: _start,
            set: _set,
            status: _status,
            inc: _inc,
            complete: _complete,
            latencyThreshold: this.latencyThreshold,
            parentSelector: this.parentSelector,
            startSize: this.startSize
        };
    }];
});
app.directive('infiniteScroll', [function () {
    return function (scope, element, attrs) {
        var raw = element[0], _scrollMe = function () {
            if (raw.scrollTop + raw.offsetHeight >= raw.scrollHeight) {
                scope.$apply(attrs.infiniteScroll); // execute the given function to load data when scroll bar reached to bottom
            }
        };
        element.bind('scroll', _scrollMe);
        scope.$on('$destroy', function () {
            element.unbind('scroll', _scrollMe); //destroy the scroll event
        });
    };
}]);
app.directive('customHeight', ['$window', function ($window) {
    return function (scope, element) {
        var windowObj = angular.element($window),
            _setHeight = function () {
                var setHeight = (jQuery(window).height() - element.offset().top).toString() + 'px',
                    heightCss = {
                        'height': setHeight
                    };
                element.css(heightCss);
            };
        windowObj.bind('resize', _setHeight); // recalculate the height when window got resize
        _setHeight(); //set dynamic height for div
        scope.$on('$destroy', function () {
            windowObj.unbind('resize', _setHeight);
        });
    };
}]);
app.directive('facebookShare', ['$window', '$location', function ($window, $location) {
    return {
        restrict: 'ACEM',
        scope: {},
        link: function (scope, element, attrs) {
            var getCurrentUrl, handler, popupWinAttrs, urlFactory;
            popupWinAttrs = "status=no, width=" + (scope.socialWidth || 640) + ", height=" + (scope.socialWidth || 480) + ", resizable=yes, toolbar=no, menubar=no, scrollbars=no, location=no, directories=no";
            getCurrentUrl = function () {
                return attrs.customUrl || $location.absUrl();
            },
                urlFactory = function (url) {
                    var shareUrl;
                    shareUrl = ["https://facebook.com/sharer.php?"];
                    shareUrl.push("u=" + (encodeURIComponent(url)));
                    return shareUrl.join('');
                },
                handler = function (e) {
                    var url, win;
                    e.preventDefault();
                    url = urlFactory(getCurrentUrl());
                    return win = $window.open(url, 'popupwindow', popupWinAttrs).focus();
                };
            attrs.$observe('customUrl', function () {
                var url;
                url = urlFactory(getCurrentUrl());
                if (element[0].nodeName === 'A' && ((attrs.href == null) || attrs.href === '')) {
                    return element.attr('href', url);
                }
            });
            element.on('click', handler);
            scope.$on('$destroy', function () {
                element.off('click', handler);
            });
        }
    };
}]);
app.controller('MainController', ['$scope', '$http', '$window', '$timeout', function ($scope, $http, $window, $timeout) {
    var page_no = 0, // page number for on load
        windowObj = angular.element($window);
    $scope.isInfiniteScroll = true; // whether infinite scroll is on or off
    $scope.imageList = []; // store list for each scroll
    // basic configuration for high chart
    $scope.chartConfig = {
        options: {
            chart: {
                type: 'pie'
            },
            tooltip: {
                formatter: function () {
                    return this.point.name + " - " + this.point.y;
                }
            },
            plotOptions: {
                pie: {
                    allowPointSelect: true,
                    cursor: 'pointer',
                    dataLabels: {
                        format: '<b>{point.name}</b> - {point.y} ',
                        style: {
                            color: (Highcharts.theme && Highcharts.theme.contrastTextColor) || 'black'
                        }
                    }
                }
            }
        },
        series: [
            {
                data: []
            }
        ]
    };
    /**
     * get data from web API,
     * get total number of likes
     */
    $scope.loadMore = function () {
        var saved = JSON.parse(localStorage.getItem("saved")); // get saved data from local storage
        if ($scope.isInfiniteScroll && !$scope.busy) { // check infinite scroll is on or off
            $scope.busy = true; // loading data from server
            $http.get('https://gainsight.0x10.info/api/image?page_no=' + page_no).then(function (response) {
                var items = response.data;
                for (var i = 0; i < items.length; i++) {
                    $scope.imageList.push(items[i]);
                }
                if (saved && saved.length > 0) {
                    _.each(saved, function (value) {
                        _.each($scope.imageList, function (image, key) {
                            if (image.name === value.name) {
                                $scope.imageList[key].liked = true; // check whether same records is stored as liked
                            }
                        })
                    })
                }
                $scope.imageListData = _.chunk($scope.imageList, 3); // create array of 3 columns
                $scope.busy = false; // data loaded
                $scope.getTotalLikes(); //get total no of likes
                page_no += 1;
            });
        }
    };
    /**
     * Returns the total number of liked
     * for currently loaded images
     */
    $scope.getTotalLikes = function () {
        $scope.totalLikes = 0;
        _.each($scope.imageList, function (value) {
            if (value.liked === true) {
                $scope.totalLikes += 1;
            }
        })
    };
    /**
     * get data for selected image ,
     * set visible for like, download and share buttons for seleted image
     */
    $scope.getGraph = function (item) {
        $scope.chartConfig.series[0].data = [];
        _.each(item.demographic, function (value, key) {
            $scope.chartConfig.series[0].data.push({"name": key, "y": value})
        });
        $scope.chartConfig.title = {"text": item.name};
        $scope.showGraph = true;
        _.each($scope.imageListData, function (value, parentIndex) {
            _.each(value, function (eachImage, key) {
                if (item.name === eachImage.name) {
                    $scope.imageListData[parentIndex][key].showDetails = true;
                }
                else {
                    $scope.imageListData[parentIndex][key].showDetails = false;
                }
            })
        });
        $timeout(function () {
            windowObj.triggerHandler('resize')
        });

    };
    /**
     * make selected image as liked and store the same in local storage
     * increment total no likes
     */
    $scope.setLike = function (item) {
        item.liked = !item.liked;
        var dataToSave = [];
        _.each($scope.imageListData, function (eachrow, rownum) {
            _.each(eachrow, function (value, key) {
                if (value.liked === true) {
                    dataToSave.push($scope.imageListData[rownum][key]);
                }
            })
        });
        localStorage.setItem("saved", JSON.stringify(dataToSave));
        $scope.getTotalLikes();
    };
    $scope.loadMore(); // load data on page load
}]);