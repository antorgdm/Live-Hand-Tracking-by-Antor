
import React from 'react';
import HandTracker from './components/HandTracker';
import { GithubIcon } from './components/Icons';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <header className="w-full max-w-4xl flex justify-between items-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">
          Live Hand Tracker
        </h1>
        <a 
          href="https://github.com/google/gemini-api-cookbook" 
          target="_blank" 
          rel="noopener noreferrer" 
          aria-label="GitHub Repository"
          className="text-slate-400 hover:text-cyan-400 transition-colors"
        >
          <GithubIcon className="w-8 h-8" />
        </a>
      </header>
      <main className="w-full max-w-4xl flex-grow flex flex-col items-center justify-center">
        <HandTracker />
      </main>
      <footer className="w-full max-w-4xl text-center text-slate-500 mt-6 text-sm">
        <p>Powered by MediaPipe & React. Styled with Tailwind CSS.</p>
      </footer>
    </div>
  );
};

export default App;
