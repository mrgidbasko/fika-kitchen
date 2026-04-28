// auth.js
var FIREBASE_URL = 'https://fika-d21a6-default-rtdb.europe-west1.firebasedatabase.app';
var FIREBASE_KEY = 'AIzaSyAnzdppky1EjfURZJNQNdwBvIGBjyW4fcI';
var AUTH_URL     = 'https://identitytoolkit.googleapis.com/v1/accounts';
var LOGIN_DOMAIN = '@fika.kitchen';

var currentUser = null;

function loginToEmail(login) {
  return login.indexOf('@') === -1 ? login + LOGIN_DOMAIN : login;
}

function authLogin(login, password) {
  var email = loginToEmail(login);
  return fetch(AUTH_URL + ':signInWithPassword?key=' + FIREBASE_KEY, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({email:email, password:password, returnSecureToken:true})
  })
  .then(function(r){ return r.json(); })
  .then(function(d) {
    if (d.error) throw new Error(d.error.message);
    var uid = d.localId, token = d.idToken;
    return fetch(FIREBASE_URL + '/users/' + uid + '.json?auth=' + token)
      .then(function(r){ return r.json(); })
      .then(function(rec) {
        currentUser = {
          uid: uid, token: token,
          login: login, email: d.email,
          name: (rec && rec.name) || login,
          role: (rec && rec.role) || 'cook'
        };
        localStorage.setItem('fika_user', JSON.stringify(currentUser));
        return currentUser;
      });
  });
}

function authLogout() {
  currentUser = null;
  localStorage.removeItem('fika_user');
  localStorage.removeItem('fika_admin');
  if (typeof showAuthScreen === 'function') showAuthScreen();
}

function authRestoreSession() {
  try {
    var saved = localStorage.getItem('fika_user');
    if (saved) currentUser = JSON.parse(saved);
  } catch(e) { currentUser = null; }
  return currentUser;
}

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

// ---- Admin: manage users ----

function adminGetUsers() {
  return fetch(FIREBASE_URL + '/users.json?auth=' + currentUser.token)
    .then(function(r){ return r.json(); });
}

function adminCreateUser(login, password, name, role) {
  var email = loginToEmail(login);
  return fetch(AUTH_URL + ':signUp?key=' + FIREBASE_KEY, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({email:email, password:password, returnSecureToken:true})
  })
  .then(function(r){ return r.json(); })
  .then(function(d) {
    if (d.error) throw new Error(d.error.message);
    return fetch(FIREBASE_URL + '/users/' + d.localId + '.json?auth=' + currentUser.token, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email:email, login:login, name:name||login, role:role||'cook', createdAt:Date.now()})
    }).then(function(r){ return r.json(); });
  });
}

function adminUpdateRole(uid, role) {
  return fetch(FIREBASE_URL + '/users/' + uid + '/role.json?auth=' + currentUser.token, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(role)
  }).then(function(r){ return r.json(); });
}

function adminDeleteUser(uid) {
  return fetch(FIREBASE_URL + '/users/' + uid + '.json?auth=' + currentUser.token, {
    method: 'DELETE'
  }).then(function(r){ return r.json(); });
}
