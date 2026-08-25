const ecc = require('@bitcoin-js/tiny-secp256k1-asmjs');
const { Buffer } = require('buffer');
globalThis.Buffer = Buffer;
const { crypto, initEccLib, networks, payments, Psbt } = require('bitcoinjs-lib');

initEccLib(ecc);

function networkParams(network) {
  if (network?.bech32 === 'bc') {
    return networks.bitcoin;
  }

  return network?.bech32 === 'bcrt' ? networks.regtest : networks.testnet;
}

function publicKeyFromPrivate(privateKey) {
  const publicKey = ecc.pointFromScalar(Buffer.from(privateKey), true);
  if (!publicKey) {
    throw new Error('invalid private key');
  }

  return Buffer.from(publicKey);
}

function toXOnly(publicKey) {
  return publicKey.length === 32 ? Buffer.from(publicKey) : Buffer.from(publicKey).subarray(1, 33);
}

function taprootSigner(privateKey, internalPubkey) {
  const publicKey = publicKeyFromPrivate(privateKey);
  const tweak = crypto.taggedHash('TapTweak', internalPubkey);
  const basePrivateKey = publicKey[0] === 0x03 ? Buffer.from(ecc.privateNegate(privateKey)) : Buffer.from(privateKey);
  const tweakedPrivateKey = ecc.privateAdd(basePrivateKey, tweak);

  if (!tweakedPrivateKey) {
    throw new Error('invalid taproot tweak');
  }

  const tweakedPublicKey = publicKeyFromPrivate(tweakedPrivateKey);

  return {
    publicKey: toXOnly(tweakedPublicKey),
    sign: (hash) => Buffer.from(ecc.sign(hash, tweakedPrivateKey)),
    signSchnorr: (hash) => Buffer.from(ecc.signSchnorr(hash, tweakedPrivateKey)),
  };
}

function p2wpkh(publicKey, network) {
  return {
    script: payments.p2wpkh({ pubkey: Buffer.from(publicKey), network: networkParams(network) }).output,
  };
}

class Transaction {
  constructor() {
    this.network = undefined;
    this.inputs = [];
    this.psbt = undefined;
  }

  ensurePsbt(network) {
    if (!this.psbt) {
      this.network = networkParams(network);
      this.psbt = new Psbt({ network: this.network });
    }
  }

  addInput(input) {
    this.ensurePsbt();
    this.inputs.push(input);
    this.psbt.addInput({
      hash: Buffer.from(input.txid).toString('hex'),
      index: input.index,
      witnessUtxo: {
        script: Buffer.from(input.witnessUtxo.script),
        value: Number(input.witnessUtxo.amount),
      },
      ...(input.tapInternalKey ? { tapInternalKey: Buffer.from(input.tapInternalKey) } : {}),
    });
  }

  addOutput(output) {
    this.ensurePsbt();
    this.psbt.addOutput({
      script: Buffer.from(output.script),
      value: Number(output.amount),
    });
  }

  addOutputAddress(recipient, amount, network) {
    this.ensurePsbt(network);
    this.psbt.addOutput({
      address: recipient,
      value: Number(amount),
    });
  }

  sign(privateKey) {
    const publicKey = publicKeyFromPrivate(privateKey);
    const ecdsaSigner = {
      publicKey,
      sign: (hash) => Buffer.from(ecc.sign(hash, privateKey)),
    };

    this.inputs.forEach((input, index) => {
      try {
        if (input.tapInternalKey) {
          this.psbt.signInput(index, taprootSigner(privateKey, Buffer.from(input.tapInternalKey)));
        } else {
          this.psbt.signInput(index, ecdsaSigner);
        }
      } catch {
        // Mirrors scure's sign-all-possible behavior for this narrow test shim.
      }
    });
  }

  finalize() {
    this.psbt.finalizeAllInputs();
  }

  get hex() {
    return this.psbt.extractTransaction().toHex();
  }
}

module.exports = { Transaction, p2wpkh };
