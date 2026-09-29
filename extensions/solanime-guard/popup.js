const form = document.querySelector('#settings');
const enabled = document.querySelector('#enabled');
const strict = document.querySelector('#strict');
const hosts = document.querySelector('#hosts');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const button = form.querySelector('button');
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}
async function load() {
  try {
    const data = await send({ type: 'get-options' });
    enabled.checked = data.options.enabled;
    strict.checked = data.options.strict;
    hosts.value = data.options.mediaHosts.join('\n');
    status.textContent = `${data.tabs} supported tab${data.tabs === 1 ? '' : 's'} open`;
  } catch (cause) {
    error.textContent = cause.message;
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = '';
  try {
    await send({
      type: 'set-options',
      value: {
        enabled: enabled.checked,
        strict: strict.checked,
        mediaHosts: hosts.value.split(/\s+/).filter(Boolean),
      },
    });
    status.textContent = 'Settings saved';
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    button.disabled = false;
  }
});
void load();
