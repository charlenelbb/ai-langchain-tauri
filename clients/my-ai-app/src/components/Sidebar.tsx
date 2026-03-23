import React from 'react';
import { Button } from './ui/button';

interface SidebarProps {
  activeModule: string;
  onModuleChange: (module: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeModule, onModuleChange }) => {
  const modules = [
    { id: 'medical', label: '医疗问答', icon: '🏥' },
    { id: 'rag', label: 'RAG 知识库', icon: '📚' },
    { id: 'image', label: '文生图', icon: '🖼️' },
  ];

  return (
    <div className="w-64 bg-gray-800 text-white h-full flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">AI 助手平台</h1>
      </div>

      <nav className="flex-1 p-4">
        <div className="space-y-2">
          {modules.map((module) => (
            <Button
              key={module.id}
              onClick={() => onModuleChange(module.id)}
              className={`w-full justify-start text-left ${
                activeModule === module.id
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <span className="mr-3">{module.icon}</span>
              {module.label}
            </Button>
          ))}
        </div>
      </nav>

      <div className="p-4 border-t border-gray-700">
        <div className="text-sm text-gray-400">
          <p>版本: 1.0.0</p>
          <p>状态: 运行中</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
