import './style.css';

if (location.hash === '#presentation') {
  import('./presentation.js').then(({ startPresentation }) => startPresentation());
} else {
  import('./main.js');
}
