// users.js — User management

function usersGet(uid, token) {
  return fetch(FIREBASE_URL + '/users/' + uid + '.json?auth=' + token)
    .then(function(r){ return r.json(); });
}

function usersSetRole(uid, role, adminToken) {
  return fetch(FIREBASE_URL + '/users/' + uid + '/role.json?auth=' + adminToken, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(role)
  }).then(function(r){ return r.json(); });
}

function usersGetAll(adminToken) {
  return fetch(FIREBASE_URL + '/users.json?auth=' + adminToken)
    .then(function(r){ return r.json(); });
}
