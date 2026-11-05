const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');
const logic = source.slice(source.indexOf('function recoverySendError('), source.indexOf("$('#forgot').onclick=requestRecoveryEmail;"));
function setup(send) {
 const nodes = {
  '#email': {value: 'pelc@example.test', checkValidity: () => true},
  '#forgot': {disabled: false},
  '#authError': {textContent: ''}
 };
 let calls = 0;
 const context = {
  $: selector => nodes[selector],
  Date,
  appReturnUrl: 'https://example.test/',
  db: {auth: {resetPasswordForEmail: async (...args) => {calls++; return send(...args);}}}
 };
 vm.createContext(context);
 vm.runInContext(logic, context);
 return {context, nodes, calls: () => calls};
}
(async () => {
 const rate = setup(async () => ({error: {status: 429, code: 'over_email_send_rate_limit'}}));
 await rate.context.requestRecoveryEmail();
 assert.match(rate.nodes['#authError'].textContent, /vyčerpán limit/);
 assert.equal(rate.nodes['#forgot'].disabled, false);

 let finish;
 const concurrent = setup(() => new Promise(resolve => {finish = resolve;}));
 const first = concurrent.context.requestRecoveryEmail();
 await concurrent.context.requestRecoveryEmail();
 assert.equal(concurrent.calls(), 1);
 assert.equal(concurrent.nodes['#forgot'].disabled, true);
 finish({error: null});
 await first;
 await concurrent.context.requestRecoveryEmail();
 assert.equal(concurrent.calls(), 1);
 assert.match(concurrent.nodes['#authError'].textContent, /alespoň minutu/);

 const failed = setup(async () => {throw Error('Offline');});
 await failed.context.requestRecoveryEmail();
 assert.equal(failed.nodes['#forgot'].disabled, false);
 assert.match(failed.nodes['#authError'].textContent, /připojení/);
 console.log('PASS email rate limit, concurrent clicks, successful-send cooldown and network failure');
})().catch(error => {console.error(error); process.exitCode = 1;});
