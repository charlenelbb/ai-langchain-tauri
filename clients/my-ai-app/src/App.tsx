import { useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import MedicalModule from './components/modules/MedicalModule';
import RagModule from './components/modules/RagModule';
import ImageGenModule from './components/modules/ImageGenModule';

function App() {
  const [activeModule, setActiveModule] = useState('medical');

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'medical':
        return <MedicalModule />;
      case 'rag':
        return <RagModule />;
      case 'image':
        return <ImageGenModule />;
      default:
        return <MedicalModule />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <div className="flex-1 overflow-auto">{renderActiveModule()}</div>
    </div>
  );
}

export default App;
