// Configurazione dell'app. I valori di Firebase per le app web non sono segreti (la sicurezza sta nelle regole
// di Firestore e nel codice casa): è normale che siano pubblici. Facoltativo ma consigliato: limita la chiave API
// ai tuoi domini in Google Cloud Console → API e servizi → Credenziali (referrer: https://iantomasi-nicola.github.io/*).
window.CASA_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyAFnhsw7vCoz7xMlVEmcaJJtvANSFTaVFc',
    authDomain: 'tidyhouse-ef92b.firebaseapp.com',
    projectId: 'tidyhouse-ef92b',
    storageBucket: 'tidyhouse-ef92b.firebasestorage.app',
    messagingSenderId: '209890570298',
    appId: '1:209890570298:web:bf8f72747270af526b8503',
  },
  // Facoltativo: URL pubblico dell'app se diverso da quello da cui viene aperta (es. dominio personalizzato).
  publicUrl: '',
};
