import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// Meeting requests build the first screen here.
function App() { return <main aria-label="Empty workspace" />; }
createRoot(document.getElementById('root')).render(<App />);
