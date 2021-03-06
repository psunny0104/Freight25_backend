'use strict';

// import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request-promise');

// Firebase setup
const firebaseAdmin = require('firebase-admin');
// you should manually put your service-account.json in the same folder app.js
// is located at.
const serviceAccount = require('./service-account.json');

// Kakao API request url to retrieve user profile based on access token
const requestMeUrl = 'https://kapi.kakao.com/v2/user/me?secure_resource=true';

// Initialize FirebaseApp with service-account.json
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
});

let db = firebaseAdmin.firestore();

/**
 * requestMe - Returns user profile from Kakao API
 *
 * @param  {String} kakaoAccessToken Access token retrieved by Kakao Login API
 * @return {Promiise<Response>}      User profile response in a promise
 */
function requestMe(kakaoAccessToken) {
  console.log('Requesting user profile from Kakao API server.');
  return request({
    method: 'GET',
    headers: {'Authorization': 'Bearer ' + kakaoAccessToken},
    url: requestMeUrl,
  });
};


/**
 * updateOrCreateUser - Update Firebase user with the give email, create if
 * none exists.
 *
 * @param  {String} userId        user id per app
 * @param  {String} email         user's email address
 * @param  {String} displayName   user
 * @param  {String} photoURL      profile photo url
 * @return {Prommise<UserRecord>} Firebase user record in a promise
 */
function updateOrCreateUser(userId, email, displayName, photoURL) {
  console.log('updating or creating a firebase user');
  const updateParams = {
    provider: 'KAKAO',
    displayName: displayName,
  };
  if (displayName) {
    updateParams['displayName'] = displayName;
  } else {
    updateParams['displayName'] = email;
  }
  if (photoURL) {
    updateParams['photoURL'] = photoURL;
  }
  if (email) {
    updateParams['email'] = email;
  }
  console.log(updateParams);
  return firebaseAdmin.auth().updateUser(userId, updateParams)
  .catch((error) => {
    if (error.code === 'auth/user-not-found') {
      updateParams['uid'] = userId;
      if (email) {
        updateParams['email'] = email;
      }
      return firebaseAdmin.auth().createUser(updateParams);
    }
    throw error;
  });
};


/**
 * createFirebaseToken - returns Firebase token using Firebase Admin SDK
 *
 * @param  {String} kakaoAccessToken access token from Kakao Login API
 * @return {Promise<String>}                  Firebase token in a promise
 */
function createFirebaseToken(kakaoAccessToken, type) {
  var userType = type;
  console.log("1"+userType);
  return requestMe(kakaoAccessToken).then((response) => {
    const body = JSON.parse(response);
    console.log(body);
    const userId = `${body.id}`;
    if (!userId) {
      return res.status(404)
      .send({message: 'There was no user with the given access token.'});
    }
    let nickname = null;
    let profileImage = null;
    let email = null
    if (body.properties) {
      nickname = body.properties.nickname;
      profileImage = body.properties.profile_image;
    }
    if (body.kakao_account.email)
      email = body.kakao_account.email;
    return updateOrCreateUser(userId, email, nickname,
      profileImage);
  }).then((userRecord) => {
    const userId = userRecord.uid;
    console.log(`creating a custom firebase token based on uid ${userId}`);
    //db create drivers만 가능 -> 수정 필요
    let ref = null;
    console.log("2"+userType);
    if(userType == 'drivers'){
      ref = db.collection('drivers').doc(userId);
    }
    else if(userType == 'owners'){
      ref = db.collection('owners').doc(userId);  
    }
    console.log("ref: "+ref);
    ref.get()
      .then(doc => {
        if(!doc.exists) {
          console.log('Added document with Id: '+userId);
          ref.set({name: userRecord.displayName});
      } else {
          console.log('Aleady Exist user - Document data:', doc.data());
      }
    });
    return firebaseAdmin.auth().createCustomToken(userId, {provider: 'KAKAO'});
  });
};


// create an express app and use json body parser
const app = express();
app.use(bodyParser.json());


// default root url to test if the server is up
app.get('/', (req, res) => res.status(200)
.send('KakaoLoginServer for Firebase is up and running!'));

// actual endpoint that creates a firebase token with Kakao access token
app.post('/verifyToken', (req, res) => {
  const token = req.body.token;
  const type = req.body.type;

  console.log(token);
  if (!token) return res.status(400).send({error: 'There is no token.'})
  .send({message: 'Access token is a required parameter.'});

  console.log(`Verifying Kakao token: ${token}`);

  createFirebaseToken(token, type).then((firebaseToken) => {
    console.log(`Returning firebase token to user: ${firebaseToken}`);
    res.send({firebase_token: firebaseToken});
  });
});

// 이미 서버에 uid가 존재하는지 확인
app.post('/confirmUid',(req,res) => {
  const token = req.body.token;
  if (!token) return res.status(400).send({error: 'There is no token.'})
  .send({message: 'Access token is a required parameter.'});

  console.log(`Verifying Kakao token: ${token}`);

  requestMe(token).then((response) => {
    const body = JSON.parse(response);
    console.log(body);
    const userId = `${body.id}`;
    if (!userId) {
      return res.status(404)
      .send({message: 'There was no user with the given access token.'});
    }
    
    firebaseAdmin.auth().getUser(userId)
    .then(function(userRecord){
      //존재하는 경우 바로 인증함
      let type = null;
      let ref = db.collection('drivers').doc(userId);  
       ref.get()
        .then(doc => {
          if(!doc.exists) {
            type = 'owners';
            console.log('Aleady Exist Owner:', doc.data());
        } else {
            type = 'drivers';
            console.log('Aleady Exist Driver:', doc.data());
        }
        createFirebaseToken(token, type).then((firebaseToken) => {
          console.log(`Returning firebase token to user: ${firebaseToken}`);
          console.log(userId+' was alreday registered');
          res.send({register: true, firebase_token: firebaseToken});
        });
      });
    })
    .catch(function(error){
      console.log(userId+' was not registered');
      res.send({register: false});
    });
  });
});

// Start the server
const server = app.listen(process.env.PORT || '8000', () => {
  console.log('KakaoLoginServer for Firebase listening on port %s',
  server.address().port);
});

