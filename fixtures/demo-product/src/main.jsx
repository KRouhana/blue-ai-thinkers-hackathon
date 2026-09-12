import React from 'react';
import { createRoot } from 'react-dom/client';
import config from '../public/fork-config.json';
import './style.css';

const sizes = { sm: '8px 12px', md: '12px 20px', lg: '18px 28px', xl: '24px 36px' };
const colors = { neutral: '#263247', blue: '#2459ce', red: '#ab3340', green: '#227151', amber: '#865b12' };
const radii = { none: 0, sm: 4, md: 10, pill: 999 };

export function StartButton() {
  const value = config.elements['start-button'] ?? {};
  return <button data-fork-id="start-button" data-fork-editable="size,background,label,radius,visible"
    hidden={value.visible === false}
    style={{ padding: sizes[value.size ?? 'md'], background: colors[value.background ?? 'blue'], borderRadius: radii[value.radius ?? 'md'] }}>
    {value.label ?? 'Start here'}
  </button>;
}

function App() {
  return <main><p className="eyebrow">LOCAL WORKSPACE</p><h1>A place to start.</h1>
    <p>This is a prepared blank template. Meeting changes will appear here.</p><StartButton /></main>;
}

createRoot(document.getElementById('root')).render(<App />);
