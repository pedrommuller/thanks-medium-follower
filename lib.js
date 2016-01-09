/*jslint node: true, vars: true, nomen: true, indent: 4, maxerr: 50 */

'use strict';
var request = require('request');
var mongodb = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var Twit = require('twit');
var async = require('async');
module.exports = function (ctx, done) {
    var requestUrl = 'https://medium.com/@pedromuller/follow-list?listType=followers&page=0';
    this.mediumAccessToken = ctx.data.mediumAccessToken;
    this.twitterAccessToken = ctx.data.twitterAccessToken;
    this.twitterAccessToken_secret = ctx.data.twitterAccessToken_secret;
    this.twitterConsumer_key = ctx.data.twitterConsumer_key;
    this.twitterConsumer_secret = ctx.data.twitterConsumer_secret;
    this.mongoUrl = ctx.data.mongoUrl;
    this.makeRequest = function (URL, callback) {
        request({
            headers: {
                'Content-type': 'application/json',
                'Authorization': 'Bearer ' + this.mediumAccessToken,
                'Accept': 'application/json',
                'Accept-Charset': 'utf-8'
            },
            url: URL
        }, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var jsonResponse;
                try {
                    jsonResponse = JSON.parse(body.substr(body.indexOf('{'), body.lastIndexOf('}')));
                } catch (e) {
                    callback(e);
                }
                if (!!jsonResponse.payload && !!jsonResponse.payload.value) {
                    var followers = jsonResponse.payload.value.map(function (follower) {
                        if (follower.twitterScreenName === '') {
                            return;
                        }
                        return follower.twitterScreenName;
                    });
                    callback(null, followers);
                } else {
                    callback({ 'error': 'no followers' });
                }
            } else {
                callback({
                    'error': error,
                    'statusCode': response.statusCode,
                    'response': response
                });
            }
        });
    };
    this.saveToDatabase = function (followers, callback) {
        var documents;
        var difference = followers;
        mongodb.connect(this.mongoUrl, function (err, db) {
            if (err) {
                db.close();
                callback(err);
            }
            db.collection('followers').find({ twitter: { $in: followers } }, {
                'twitter': 1,
                '_id': 0
            }).toArray(function (err, data) {
                var i = 0;
                if (err) {
                    callback(err);
                }
                if (data.length > 0) {
                    difference = followers.filter(function (e) {
                        for (i = 0; i < data.length; i = +1) {
                            if (data[i].twitter === e) {
                                return false;
                            }
                        }
                        return true;
                    });
                }
                if (Array.isArray(difference) && difference.length > 0) {
                    documents = difference.map(function (element) {
                        return {
                            _id: new ObjectID(),
                            twitter: element,
                            sent: false
                        };
                    });
                    db.collection('followers').insert(documents, {
                        continueOnError: true,
                        safe: true
                    }, function (err) {
                        db.close();
                        if (err) {
                            callback(err);
                        }
                        callback();
                    });
                } else {
                    db.close();
                    callback();
                }
                return;
            });
        });
    };
    this.sendTweetToFollower = function (callback) {
        var T = new Twit({
            consumer_key: this.twitterConsumer_key,
            consumer_secret: this.twitterConsumer_secret,
            access_token: this.twitterAccessToken,
            access_token_secret: this.twitterAccessToken_secret
        });
        mongodb.connect(this.mongoUrl, function (err, db) {
            if (err) {
                db.close();
                callback(err);
            }
            db.collection('followers').find({ sent: false }).toArray(function (err, data) {
                if (data.length === 0) {
                    callback();
                } else if (err) {
                    callback(err);
                }
                async.eachSeries(data, function (element, callback) {
                    T.post('statuses/update', { status: '@' + element.twitter + ' Gracias por seguirme en Medium, un abrazo!' }, function (err) {
                        if (err) {
                            callback(err);
                        }
                        element.sent = true;
                        db.collection('followers').updateOne({ '_id': element._id }, { $set: { sent: true } }, function (err) {
                            db.close();
                            if (err) {
                                callback(err);
                            }
                            callback(null);
                        });
                    });
                }, function (err) {
                    if (err) { throw err; }
                });
            });
        });
    };
    this.makeRequest(requestUrl, function (error, followers) {
        if (error) {
            done(error);
        } else {
            this.saveToDatabase(followers, function (err) {
                if (err) {
                    done(error);
                }
                this.sendTweetToFollower(function (err) {
                    if (err) {
                        done(error);
                    }
                    done(null, 'OK');
                });
            });
        }
    });
};