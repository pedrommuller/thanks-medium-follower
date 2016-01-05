var request = require('request'),
    mongodb = require('mongodb').MongoClient,
    ObjectID = require('mongodb').ObjectID,
    Twit = require('twit');
   
module.exports = function (ctx,done) {
    var requestUrl = 'https://medium.com/@pedromuller/follow-list?listType=followers&page=0';

    this._mediumAccessToken = ctx.data.mediumAccessToken;
    this._twitterAccessToken = ctx.data.twitterAccessToken;
    this._twitterAccessToken_secret = ctx.data.twitterAccessToken_secret;
    this._twitterConsumer_key = ctx.data.twitterConsumer_key;
    this._twitterConsumer_secret = ctx.data.twitterConsumer_secret;
    this._mongoUrl = ctx.data.mongoUrl;
    
    var makeRequest = function (URL, callback) {
        request(
        {
            headers: {
                'Content-type': 'application/json',
                'Authorization': 'Bearer ' + this._mediumAccessToken,
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
                        if (follower.twitterScreenName === '')
                            return;
                        else {
                            return follower.twitterScreenName;
                        }
                    });
                    callback(null, followers)
                } else {
                    callback({ 'error': 'no followers' });
                }

            } else {
                callback({ 'error': error, 'statusCode': response.statusCode, 'response': response });
            }
        });
    }

    var saveToDatabase = function (followers, callback) {
        mongodb.connect(this._mongoUrl, function (err, db) {
            if (err) {
                db.close();
                callback(err);
            }
            db.collection('followers').find({ twitter: { $in: followers } }, { twitter: 1, _id: 0 }).toArray(function (err, data) {
                if (err) {
                    callback(err);
                }
                var difference = followers;
                if (data.length > 0) {
                    difference = followers.filter(function (e) {
                        for (var i = 0; i < data.length; i++) {
                            if (data[i].twitter === e) {
                                return false;
                            }
                        }
                        return true;
                    });
                };

                if (Array.isArray(difference) && difference.length > 0) {
                    var documents = difference.map(function (element) {
                        return { _id: new ObjectID(), twitter: element, sent: false }
                    });
                    db.collection('followers').insert(documents, { continueOnError: true, safe: true }, function (err, result) {
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
    }

    var sendTweetToFollower = function (callback) {
        var T = new Twit({
            consumer_key: this._twitterConsumer_key,
            consumer_secret: this._twitterConsumer_secret,
            access_token: this._twitterAccessToken,
            access_token_secret: this._twitterAccessToken_secret
        })

        mongodb.connect(this._mongoUrl, function (err, db) {
            if (err) {
                db.close();
                callback(err);
            }
            db.collection('followers').find({ sent: false }).toArray(function (err, data) {
                if (data.length === 0) { callback() }
                data.forEach(function (element) {
                    T.post('statuses/update', { status: '@' + element.twitter + ' Gracias por seguirme en Medium, un abrazo!' },
                    function (err, data, response) {
                        if (err) {
                            callback(err);
                        }
                       
                        element.sent = true;
                        db.collection('followers').updateOne({ _id: element._id }, { $set: { sent: true } }, function (err, result) {
                            db.close();
                            if (err) {
                                callback(err);
                            }
                            callback(null);
                        });

                    });
                });
            });

        });
    }

    makeRequest(requestUrl, function (error, followers) {
        if (error) {
            done(error);
        } else {
            saveToDatabase(followers, function (err) {
                if (err) {
                    done(error);
                }
                sendTweetToFollower(function (err, response) {
                    if (err) {
                        done(error);
                    }
                    done(null, 'OK');
                });

            });
        }

    });
    
}