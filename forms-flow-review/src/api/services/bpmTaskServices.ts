import API from "../endpoints";
import { RequestService } from "@formsflow/service";
import { replaceUrl } from "../../helper/helper";
import axios from "axios";
import { setBPMTaskDetail, setCustomSubmission, serviceActionError, setAppHistoryLoading, setApplicationHistoryList, setTaskAssignee, setTaskDetailsLoading } from "../../actions/taskActions";
import { taskDetailVariableDataFormatter } from "./formatterService";


export const getOnlyTaskDetails = (taskId)=>{
    const apiUrlgetTaskDetail = replaceUrl(
    API.GET_BPM_TASK_DETAIL,
    "<task_id>",
    taskId
  );
  return RequestService.httpGETRequest(apiUrlgetTaskDetail);
}

export const getBPMTaskDetail = (taskId, ...rest) => {
  const done = rest.length ? rest[0] : () => { };
  const apiUrlgetTaskDetail = replaceUrl(
    API.GET_BPM_TASK_DETAIL,
    "<task_id>",
    taskId
  );

  const apiUrlgetTaskVariables = replaceUrl(
    API.GET_BPM_TASK_VARIABLES,
    "<task_id>",
    taskId
  );

  const taskDetailReq = RequestService.httpGETRequest(apiUrlgetTaskDetail);
  const taskDetailsWithVariableReq = RequestService.httpGETRequest(
    apiUrlgetTaskVariables
  );

  return (dispatch) => {
    axios
      .all([taskDetailReq, taskDetailsWithVariableReq])
      .then(
        axios.spread((...responses) => {
          let taskDetails = responses[0]?.data;
          const variablesDetails = responses[1]?.data;
          if (taskDetails) {
            if (variablesDetails) {
              let formId = variablesDetails?.formId?.value;
              let formType = variablesDetails?.formType?.value;
              taskDetails = {
                ...taskDetailVariableDataFormatter(variablesDetails),
                ...taskDetails,
                formId,
                formType,
              };
            }
            dispatch(setBPMTaskDetail(taskDetails));
            dispatch(setTaskAssignee(taskDetails.assignee));
            dispatch(setTaskDetailsLoading(false));
            done(null, taskDetails);

          }
        })
      )
      .catch((error) => {
        done(error);
      });
  };
};

export const getBPMGroups = (taskId, ...rest) => {
  const done = rest.length ? rest[0] : () => { };

  const apiUrlgetGroups = replaceUrl(API.BPM_GROUP, "<task_id>", taskId);

  return (dispatch) => {
    RequestService.httpGETRequest(`${apiUrlgetGroups}?type=candidate`)
      .then((responses) => {
        if (responses?.data) {
          const groups = responses.data;
          done(null, groups);
        } else {
          done(null, []);
        }
      })
      .catch((error) => {
        dispatch(serviceActionError(error));
        done(error);
      });
  };
};

export const onBPMTaskFormSubmit = (taskId, formReq, ...rest) => { 
  const done = rest.length ? rest[0] : () => { };
  const apiUrlOnFormSubmit = replaceUrl(
    API.BPM_FORM_SUBMIT,
    "<task_id>",
    taskId
  );
  return (dispatch) => {
    RequestService.httpPOSTRequest(apiUrlOnFormSubmit, formReq)
      .then((res) => {
        done(null, res.data);
      })
      .catch((error) => {
        console.log("Error", error);
        dispatch(serviceActionError(error));
        done(error);
      });
  };
};

export const onBPMTaskFormUpdate = (taskId, formReq, ...rest) => {
  const done = rest.length ? rest[0] : () => { };
  const apiUrlOnTaskUpdate = replaceUrl(
    API.BPM_TASK_UPDATE,
    "<task_id>",
    taskId
  );
  
  return (dispatch) => {
    RequestService.httpPOSTRequest(apiUrlOnTaskUpdate, formReq)
      .then((res) => {
        done(null, res.data);
      })
      .catch((error) => {
        console.log("Error", error);
        dispatch(serviceActionError(error));
        done(error);
      });
  };
};

export const getCustomSubmission = (submissionId, formId, ...rest) => {
  const done = rest.length ? rest[0] : () => { };
  const submissionUrl = replaceUrl(API.CUSTOM_SUBMISSION, "<form_id>", formId);
  return (dispatch) => {
    RequestService.httpGETRequest(`${submissionUrl}/${submissionId}`, {})
      .then((res) => {
        if (res.data) {
          dispatch(setCustomSubmission(res.data));
        } else {
          dispatch(setCustomSubmission({}));
        }
      })
      .catch((err) => {
        done(err, null);
      });
  };
};

export const getApplicationHistory = (applicationId, ...rest) => {
  const done = rest.length ? rest[0] : () => {};
  return (dispatch) => {
    const apiUrlAppHistory = replaceUrl(
      API.GET_APPLICATION_HISTORY_API,
      "<application_id>",
      applicationId
    );

    RequestService.httpGETRequest(apiUrlAppHistory, {} )
      .then((res) => {
        if (res.data) {
          const applications = res.data.applications;
          let data = applications.map((app) => {
            return { ...app };
          });
          dispatch(setApplicationHistoryList(data));
          dispatch(setAppHistoryLoading(false));
          done(null, res.data);
        } else {
          dispatch(serviceActionError(res));
          dispatch(setAppHistoryLoading(false));
        }
      })
      .catch((error) => {
        dispatch(serviceActionError(error));
        dispatch(setAppHistoryLoading(false));
        done(error);
      });
  };
};


/**
 * m8flow task list.
 *
 * Unlike the Camunda list this is a plain GET against forms-flow-api rather than
 * a Camunda filter POST: m8flow has no filter concept, and it authorises the list
 * itself from the caller's token, returning only the tasks whose BPMN lane maps
 * to a group the user belongs to.
 */
export const fetchM8flowTaskList = (group?: string) => {
  const params = new URLSearchParams();
  if (group) params.append("group", group);
  const query = params.toString();
  return RequestService.httpGETRequest(
    query ? `${API.M8FLOW_TASKS}?${query}` : API.M8FLOW_TASKS
  );
};

/**
 * Claim an m8flow task for a user, defaulting to the caller.
 *
 * Unlike the Camunda claim this goes to forms-flow-api, which holds the
 * assignment itself -- m8flow has no claim to call. The payload key is `userId`
 * to match the Camunda call, so both engines are driven the same way.
 *
 * Rejects with 409 when someone else already holds the task; the caller decides
 * whether to unclaim first (the Camunda list does the same two-step to
 * reassign).
 */
export const claimM8flowTask = (taskId: string, userId?: string) => {
  const url = replaceUrl(API.CLAIM_M8FLOW_TASK, "<task_id>", taskId);
  return RequestService.httpPOSTRequest(url, userId ? { userId } : {});
};

/**
 * Release the claim on an m8flow task.
 *
 * Succeeds even when nobody holds it, so a stale row in the table cannot leave
 * the list stuck showing an assignee that is already gone.
 */
export const unclaimM8flowTask = (taskId: string) => {
  const url = replaceUrl(API.UNCLAIM_M8FLOW_TASK, "<task_id>", taskId);
  return RequestService.httpPOSTRequest(url, {});
};

/**
 * Approve or reject an m8flow task, advancing the workflow.
 *
 * `action` goes to the engine as the variable an approval gateway branches on
 * (`action == 'Approved'` / `'Rejected'`) -- the same contract the no-code
 * designer generates for Camunda.
 *
 * Rejects with 409 when the task is claimed by someone else.
 */
export const completeM8flowTask = (
  taskId: string,
  action: "Approved" | "Rejected",
  variables?: Record<string, unknown>
) => {
  const url = replaceUrl(API.COMPLETE_M8FLOW_TASK, "<task_id>", taskId);
  return RequestService.httpPOSTRequest(url, { action, ...(variables ? { variables } : {}) });
};
