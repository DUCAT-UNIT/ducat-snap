import { discoverFlask, connectLocalSnap } from './connector.mjs';
const findFlask = discoverFlask();
const button = document.querySelector('#connect');
const status = document.querySelector('#status');
button.addEventListener('click', async () => {
  button.disabled = true;
  document.querySelector('#connected').hidden = true;
  try {
    status.textContent = 'Looking for MetaMask Flask…';
    const provider = await findFlask();
    status.textContent = 'Approve the local Ducat Snap request in MetaMask Flask.';
    const installed = await connectLocalSnap(provider);
    status.textContent = `Ducat ${installed.version} is connected. Open MetaMask Flask → Snaps → Ducat to view Home.`;
    document.querySelector('#connected').hidden = false;
    button.textContent = 'Reconnect local build';
  } catch (error) {
    status.textContent = error?.code === 4001 ? 'Connection cancelled. You can try again whenever you’re ready.' : error instanceof TypeError ? 'Could not reach the local Snap server. Make sure the preview is running.' : error.message || 'Could not connect. Check MetaMask Flask and try again.';
  } finally { button.disabled = false; }
});
