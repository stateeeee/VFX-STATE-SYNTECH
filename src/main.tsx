import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import IntroSplash, {shouldPlayIntro} from './components/IntroSplash.tsx';
import './index.css';

/* The app mounts at once; the intro (desktop app only) plays on top of it and
   removes itself — see IntroSplash.tsx. */
function Root() {
  const [intro, setIntro] = useState(shouldPlayIntro);
  return (
    <>
      <App />
      {intro && <IntroSplash onDone={() => setIntro(false)} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
