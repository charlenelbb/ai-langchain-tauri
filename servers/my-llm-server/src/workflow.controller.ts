import { Controller, Post, Body } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post('execute')
  async executeWorkflow(@Body() body: { graphData: any; input: any }) {
    return this.workflowService.executeWorkflow(body.graphData, body.input);
  }
}
