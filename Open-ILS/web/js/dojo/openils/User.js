/* ---------------------------------------------------------------------------
 * Copyright (C) 2008  Georgia Public Library Service
 * Bill Erickson <erickson@esilibrary.com>
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * ---------------------------------------------------------------------------
 */

if(!dojo._hasResource["openils.User"]) {

    dojo._hasResource["openils.User"] = true;
    dojo.provide("openils.User");
    dojo.require("DojoSRF");
    dojo.require('openils.Event');
    dojo.require('fieldmapper.Fieldmapper');

    dojo.declare('openils.User', null, {

        user : null,
        username : null,
        passwd : null,
        login_type : 'opac',
        location : null,
        authtoken : null,
        authtime : null,
    
        constructor : function ( kwargs ) {
            kwargs = kwargs || {};
            this.id = kwargs.id;
            this.user = kwargs.user;
            this.passwd = kwargs.passwd;
            this.authtoken = kwargs.authtoken || openils.User.authtoken;
            this.authtime = kwargs.authtime || openils.User.authtime;
            this.login_type = kwargs.login_type;
            this.location = kwargs.location;
            this.authcookie = kwargs.authcookie || openils.User.authcookie;
	    this.orgCache = {perm: null, store: null};
	    this.fundCache = [];

            if (this.id && this.authtoken) this.user = this.getById( this.id );
            else if (this.authtoken) this.getBySession();
            else if (kwargs.login) this.login();

        },

        getBySession : function(onComplete) {
            var _u = this;
            var req = OpenSRF.CachedClientSession('open-ils.auth').request('open-ils.auth.session.retrieve', _u.authtoken);
            if(onComplete) {
                req.oncomplete = function(r) {
                    var user = r.recv().content();
                    _u.user = user;
					if (!openils.User.user) openils.User.user = _u.user;
                    if(onComplete)
                        onComplete(user);
                }
                req.send();
            } else {
                req.timeout = 10;
                req.send();
                return _u.user = req.recv().content();
            }
        },
    
        getById : function(id, onComplete) {
            var req = OpenSRF.CachedClientSession('open-ils.actor').request('open-ils.actor.user.retrieve', this.authtoken, id);
            if(onComplete) {
                req.oncomplete = function(r) {
                    var user = r.recv().content();
                    onComplete(user);
                }
                req.send();
            } else {
                req.timeout = 10;
                req.send();
                return req.recv().content();
            }
        },
    
    
        /**
         * Logs in, sets the authtoken/authtime vars, and fetches the logged in user
         */
        login_async : function(args, onComplete) {
            var _u = this;

            if (!args) args = {};
            if (!args.username) args.username = _u.username;
            if (!args.passwd) args.passwd = _u.passwd;
            if (!args.type) args.type = _u.login_type;
            if (!args.location) args.location = _u.location;

            var initReq = OpenSRF.CachedClientSession('open-ils.auth').request('open-ils.auth.authenticate.init', args.username);
    
            initReq.oncomplete = function(r) {
                var seed = r.recv().content(); 
                alert(seed);
                var loginInfo = {
                    username : args.username,
                    password : hex_md5(seed + hex_md5(args.passwd)), 
                    type : args.type,
                    org : args.location,
                };
    
                var authReq = OpenSRF.CachedClientSession('open-ils.auth').request('open-ils.auth.authenticate.complete', loginInfo);
                authReq.oncomplete = function(rr) {
                    var data = rr.recv().content();
                    _u.authtoken = data.payload.authtoken;
					if (!openils.User.authtoken) openils.User.authtoken = _u.authtoken;
                    _u.authtime = data.payload.authtime;
					if (!openils.User.authtime) openils.User.authtime = _u.authtime;
                    _u.getBySession(onComplete);
                    if(_u.authcookie) {
                        dojo.require('dojo.cookie');
                        dojo.cookie(_u.authcookie, _u.authtoken);
                    }
                }
                authReq.send();
            }
    
            initReq.send();
        },

        login : function(args) {
            var _u = this;
            if (!args) args = {};
            if (!args.username) args.username = _u.username;
            if (!args.passwd) args.passwd = _u.passwd;
            if (!args.type) args.type = _u.login_type;
            if (!args.location) args.location = _u.location;

            var seed = fieldmapper.standardRequest(
                ['open-ils.auth', 'open-ils.auth.authenticate.init'],
                [args.username]
            );

            var loginInfo = {
                username : args.username,
                password : hex_md5(seed + hex_md5(args.passwd)), 
                type : args.type,
                org : args.location,
            };

            var data = fieldmapper.standardRequest(
                ['open-ils.auth', 'open-ils.auth.authenticate.complete'],
                [loginInfo]
            );

            _u.authtoken = data.payload.authtoken;
            if (!openils.User.authtoken) openils.User.authtoken = _u.authtoken;
            _u.authtime = data.payload.authtime;
            if (!openils.User.authtime) openils.User.authtime = _u.authtime;

            if(_u.authcookie) {
                dojo.require('dojo.cookie');
                dojo.cookie(_u.authcookie, _u.authtoken);
            }
        },

    
        /**
         * Returns a list of the "highest" org units where the user
         * has the given permission.
         */
        getPermOrgList : function(perm, onload) {
    
            var req = OpenSRF.CachedClientSession('open-ils.actor').request(
                'open-ils.actor.user.work_perm.highest_org_set',
                this.authtoken, perm);
    
            req.oncomplete = function(r) {
                org_list = r.recv().content();
                onload(org_list);
            }
    
            req.send();
        },
    
        /**
         * Builds a dijit.Tree using the orgs where the user has the requested permission
         * @param perm The permission to check
         * @param domId The DOM node where the tree widget should live
         * @param onClick If defined, this will be connected to the tree widget for
         * onClick events
         */
        buildPermOrgTreePicker : function(perm, domId, onClick) {

            dojo.require('dojo.data.ItemFileReadStore');
            dojo.require('dijit.Tree');
            function buildTreePicker(r) {
                var orgList = r.recv().content();
                var store = new dojo.data.ItemFileReadStore({data:aou.toStoreData(orgList)});
                var model = new dijit.tree.ForestStoreModel({
                    store: store,
                    query: {_top:'true'},
                    childrenAttrs: ["children"],
                    rootLabel : "Location" /* XXX i18n */
                });
    
                var tree = new dijit.Tree({model : model}, dojo.byId(domId));
                if(onClick)
                    dojo.connect(tree, 'onClick', onClick);
                tree.startup()
            }
    
            fieldmapper.standardRequest(
                ['open-ils.actor', 'open-ils.actor.user.work_perm.org_unit_list'],
                {   params: [this.authtoken, perm],
                    oncomplete: buildTreePicker,
                    async: true
                }
            )
        },
    
        /**
         * Sets the store for an existing openils.widget.OrgUnitFilteringSelect 
         * using the orgs where the user has the requested permission.
         * @param perm The permission to check
         * @param selector The pre-created dijit.form.FilteringSelect object.  
         */
        buildPermOrgSelector : function(perm, selector) {
            var _u = this;
    
            dojo.require('dojo.data.ItemFileReadStore');

	    function hookupStore(store) {
		selector.store = store;
                selector.startup();
                selector.setValue(_u.user.ws_ou());
	    }

            function buildTreePicker(r) {
                var orgList = r.recv().content();
                var store = new dojo.data.ItemFileReadStore({data:aou.toStoreData(orgList)});
		hookupStore(store);
		_u.orgCache.perm = perm;
		_u.orgCache.orgStore = store;
            }
    
	    if (this.orgCache.orgStore && (perm == this.orgCache.perm)) {
		hookupStore(this.orgCache.orgStore);
	    } else {
		fieldmapper.standardRequest(
                    ['open-ils.actor', 'open-ils.actor.user.work_perm.org_unit_list'],
                    {   params: [this.authtoken, perm],
			oncomplete: buildTreePicker,
			async: true
                    }
		)
	    }
        },

        /**
         * Sets the store for an existing openils.widget.FundFilteringSelect 
         * using the funds where the user has the requested permission.
         * @param perm The permission to check
         * @param selector The pre-created dijit.form.FilteringSelect object.  
         */
	buildPermFundSelector : function(perm, selector) {
	    var _u = this;

	    dojo.require('dojo.data.ItemFileReadStore');

	    function hookupStore(store) {
		selector.store = store;
                selector.startup();
	    }

	    function buildPicker(r) {
		var msg;
		var fundList = [];
		while (msg = r.recv()) {
		    var fund = msg.content();
		    fundList.push(fund);
		}

		var store = new dojo.data.ItemFileReadStore({data:acqf.toStoreData(fundList)});

		hookupStore(store);
		_u.fundCache[perm] = store;
	    }

	    if (this.fundCache[perm]) {
		hookupStore(this.fundCache[perm]);
	    } else {
		fieldmapper.standardRequest(
		    ['open-ils.acq', 'open-ils.acq.fund.org.retrieve'],
                    {   params: [this.authtoken, null, {flesh_summary:1, limit_perm:perm}],
			oncomplete: buildPicker,
			async: true
                    }
		)
	    }
	}


    });

	openils.User.user = null;
	openils.User.authtoken = null;
	openils.User.authtime = null;
    openils.User.authcookie = null;
}


