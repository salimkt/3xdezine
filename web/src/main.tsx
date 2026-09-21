import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

// Deliberately not wrapped in StrictMode: its double-invoked effects would
// build the WebGPU device and the post-processing pipeline twice.
createRoot(container).render(<App />);
