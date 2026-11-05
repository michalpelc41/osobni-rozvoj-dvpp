const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');
const logic = source.slice(source.indexOf('function syncRecoveryFields(){'), source.indexOf('const userIcon='));
function setup(updateUser = async () => ({error: null})) {
 const nodes = {};
 const $ = selector => nodes[selector] ??= {
  hidden: false, open: false, disabled: false, value: '', textContent: '',
  show(){ this.open = true; }, close(){ this.open = false; }, setAttribute(){}
 };
 const loginInput = {}, recoveryInput = {};
 let updates = 0, loads = 0;
 const storage = new Map();
 const context = {
  $, $$: selector => selector.includes('input') ? [selector.includes('login') ? loginInput : recoveryInput] : [],
  user: null, signingOut: false, recoveryMode: false, recoveryReady: false, recoverySaving: false,
  recoveryStorageKey: 'recovery-test', authInitialized: false,
  sessionStorage: {setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k)},
  document: {body: {classList: {toggle(){}}}},
  db: {auth: {async updateUser(data){updates++; return updateUser(data);}}},
  load: async () => {loads++;}, toast(){}, history: {replaceState(){}},
  location: {pathname: '/', search: ''}, setTimeout: fn => fn()
 };
 vm.createContext(context);
 vm.runInContext(logic, context);
 return {context, $, storage, updates: () => updates, loads: () => loads};
}
(async () => {
 // Emulate the SDK emitting recovery during getSession initialization.
 const test = setup();
 test.context.handleAuthChange('PASSWORD_RECOVERY', {user: {id: 'account'}});
 assert.equal(test.context.recoveryMode, true);
 assert.equal(test.$('main').hidden, true);
 assert.equal(test.$('#recoveryFields').hidden, false);
 assert.equal(test.loads(), 0);
 assert.equal(test.storage.get('recovery-test'), 'account');
 test.$('#newPassword').value = 'new-password';
 test.$('#confirmPassword').value = 'different-password';
 await test.context.saveRecoveredPassword();
 assert.equal(test.updates(), 0);
 assert.match(test.$('#recoveryError').textContent, /neshodují/);
 test.$('#confirmPassword').value = 'new-password';
 await test.context.saveRecoveredPassword();
 assert.equal(test.updates(), 1);
 assert.equal(test.context.recoveryMode, false);
 assert.equal(test.storage.size, 0);
 assert.equal(test.$('#newPassword').value, '');
 assert.equal(test.loads(), 1);

 const failed = setup(async () => ({error: {message: 'Rejected'}}));
 failed.context.handleAuthChange('PASSWORD_RECOVERY', {user: {id: 'account'}});
 failed.$('#newPassword').value = failed.$('#confirmPassword').value = 'test-password';
 await failed.context.saveRecoveredPassword();
 assert.equal(failed.context.recoveryMode, true);
 assert.equal(failed.$('#recoverySubmit').disabled, false);
 assert.match(failed.$('#recoveryError').textContent, /nepodařilo/);

 const invalid = setup();
 await invalid.context.saveRecoveredPassword();
 assert.equal(invalid.updates(), 0);
 assert.match(invalid.$('#recoveryError').textContent, /neplatný/);

 const normal = setup();
 normal.context.handleAuthChange('SIGNED_IN', {user: {id: 'account'}});
 assert.equal(normal.context.recoveryMode, false);
 assert.equal(normal.$('main').hidden, false);
 assert.ok(source.indexOf('db.auth.onAuthStateChange(handleAuthChange)') < source.indexOf('const {data,error}=await db.auth.getSession()'));
 console.log('PASS recovery during initialization, mismatch, save, failure, invalid session, normal sign-in');
})().catch(error => { console.error(error); process.exitCode = 1; });
